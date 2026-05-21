import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MediaService } from './media.service.js';
import { ProblemError } from '../common/errors/problem.error.js';
import type {
  HeadObjectResult,
  PresignPutInput,
  PresignPutResult,
  StorageService,
} from '../common/storage/storage.service.js';

interface Row {
  id: string;
  ownerUserId: string;
  purpose: 'CAMPAIGN_PHOTO' | 'JOB_PROOF';
  status: 'PENDING' | 'UPLOADED' | 'DELETED';
  provider: 's3';
  bucket: string;
  key: string;
  publicUrl: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function makePrismaStub() {
  const rows: Row[] = [];
  const stub = {
    mediaAsset: {
      create: vi.fn(({ data }: { data: Partial<Row> }) => {
        const row: Row = {
          id: `media_${rows.length + 1}`,
          ownerUserId: data.ownerUserId!,
          purpose: data.purpose!,
          status: data.status ?? 'PENDING',
          provider: 's3',
          bucket: data.bucket!,
          key: data.key!,
          publicUrl: data.publicUrl!,
          filename: data.filename!,
          contentType: data.contentType!,
          sizeBytes: data.sizeBytes ?? 0,
          uploadedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        rows.push(row);
        return Promise.resolve(row);
      }),
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(rows.find((r) => r.id === where.id) ?? null),
      ),
      update: vi.fn(({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data, { updatedAt: new Date() });
        return Promise.resolve(row);
      }),
    },
  };
  return { stub, rows };
}

function makeStorageStub(opts: { head?: HeadObjectResult | null } = {}) {
  const presigned: PresignPutResult = {
    url: 'https://s3.test/uploads/signed?sig=abc',
    expiresAt: new Date(Date.now() + 300_000),
    requiredHeaders: { 'Content-Type': 'image/jpeg' },
  };
  const presignPut = vi.fn((_input: PresignPutInput) => Promise.resolve(presigned));
  // `'head' in opts` so an explicit `head: null` actually stubs absence.
  const headResult: HeadObjectResult | null = 'head' in opts ? opts.head! : { sizeBytes: 1024 };
  const headObject = vi.fn(() => Promise.resolve(headResult));
  const publicUrl = vi.fn((bucket: string, key: string) => `https://cdn.test/${bucket}/${key}`);
  const buildKey = vi.fn(
    (i: { purpose: string; ownerUserId: string; assetId: string; filename: string }) =>
      `${i.purpose.toLowerCase()}/${i.ownerUserId}/${i.assetId}/${i.filename}`,
  );
  const storage = {
    bucketUploads: 'bds-uploads',
    presignPut,
    headObject,
    publicUrl,
    buildKey,
  } as unknown as StorageService;
  return { storage, presignPut, headObject, publicUrl, buildKey };
}

describe('MediaService.createUpload', () => {
  let prisma: ReturnType<typeof makePrismaStub>;
  let storage: ReturnType<typeof makeStorageStub>;
  let service: MediaService;

  beforeEach(() => {
    prisma = makePrismaStub();
    storage = makeStorageStub();
    service = new MediaService(prisma.stub as never, storage.storage);
  });

  it('persists a PENDING row + returns a signed PUT URL with the canonical headers', async () => {
    const res = await service.createUpload('user_1', {
      purpose: 'CAMPAIGN_PHOTO',
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 2048,
    });
    expect(res.assetId).toBe(prisma.rows[0]?.id);
    expect(res.uploadUrl).toContain('signed');
    expect(res.requiredHeaders['Content-Type']).toBe('image/jpeg');
    expect(prisma.rows[0]?.status).toBe('PENDING');
    expect(prisma.rows[0]?.bucket).toBe('bds-uploads');
    expect(prisma.rows[0]?.key).toContain(prisma.rows[0]?.id ?? '');
    expect(res.publicUrl).toBe(`https://cdn.test/bds-uploads/${prisma.rows[0]?.key}`);
  });

  it('embeds the asset id in the S3 key so concurrent uploads with the same filename do not collide', async () => {
    const a = await service.createUpload('user_1', {
      purpose: 'JOB_PROOF',
      filename: 'after.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 1024,
    });
    const b = await service.createUpload('user_1', {
      purpose: 'JOB_PROOF',
      filename: 'after.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 1024,
    });
    expect(a.assetId).not.toBe(b.assetId);
    expect(prisma.rows[0]?.key).not.toBe(prisma.rows[1]?.key);
  });
});

describe('MediaService.confirmUpload', () => {
  it('verifies the object via headObject and flips the row to UPLOADED', async () => {
    const prisma = makePrismaStub();
    const storage = makeStorageStub({ head: { sizeBytes: 1024 } });
    const service = new MediaService(prisma.stub as never, storage.storage);
    const created = await service.createUpload('user_1', {
      purpose: 'CAMPAIGN_PHOTO',
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 2048,
    });
    const result = await service.confirmUpload('user_1', created.assetId);
    expect(result.status).toBe('UPLOADED');
    expect(prisma.rows[0]?.uploadedAt).toBeInstanceOf(Date);
    expect(storage.headObject).toHaveBeenCalledOnce();
  });

  it('422 media.upload_not_found when the blob is absent', async () => {
    const prisma = makePrismaStub();
    const storage = makeStorageStub({ head: null });
    const service = new MediaService(prisma.stub as never, storage.storage);
    const created = await service.createUpload('user_1', {
      purpose: 'CAMPAIGN_PHOTO',
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 2048,
    });
    await expect(service.confirmUpload('user_1', created.assetId)).rejects.toMatchObject({
      status: 422,
      type: 'media.upload_not_found',
    });
    expect(prisma.rows[0]?.status).toBe('PENDING');
  });

  it('422 media.size_mismatch when the uploaded blob exceeds the declared size', async () => {
    const prisma = makePrismaStub();
    const storage = makeStorageStub({ head: { sizeBytes: 5_000_000 } });
    const service = new MediaService(prisma.stub as never, storage.storage);
    const created = await service.createUpload('user_1', {
      purpose: 'CAMPAIGN_PHOTO',
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 2048,
    });
    await expect(service.confirmUpload('user_1', created.assetId)).rejects.toMatchObject({
      status: 422,
      type: 'media.size_mismatch',
    });
  });

  it('is idempotent on a second confirm — returns the row without re-heading', async () => {
    const prisma = makePrismaStub();
    const storage = makeStorageStub({ head: { sizeBytes: 1024 } });
    const service = new MediaService(prisma.stub as never, storage.storage);
    const created = await service.createUpload('user_1', {
      purpose: 'CAMPAIGN_PHOTO',
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 2048,
    });
    await service.confirmUpload('user_1', created.assetId);
    storage.headObject.mockClear();
    const again = await service.confirmUpload('user_1', created.assetId);
    expect(again.status).toBe('UPLOADED');
    expect(storage.headObject).not.toHaveBeenCalled();
  });

  it('404 on cross-user confirm (existence-hiding)', async () => {
    const prisma = makePrismaStub();
    const storage = makeStorageStub();
    const service = new MediaService(prisma.stub as never, storage.storage);
    const created = await service.createUpload('user_1', {
      purpose: 'CAMPAIGN_PHOTO',
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 2048,
    });
    await expect(service.confirmUpload('user_2', created.assetId)).rejects.toBeInstanceOf(
      ProblemError,
    );
  });
});

describe('MediaService.getForUser', () => {
  it('returns the row when owned', async () => {
    const prisma = makePrismaStub();
    const storage = makeStorageStub();
    const service = new MediaService(prisma.stub as never, storage.storage);
    const created = await service.createUpload('user_1', {
      purpose: 'CAMPAIGN_PHOTO',
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 2048,
    });
    const row = await service.getForUser('user_1', created.assetId);
    expect(row.id).toBe(created.assetId);
  });

  it('404 on cross-user access', async () => {
    const prisma = makePrismaStub();
    const storage = makeStorageStub();
    const service = new MediaService(prisma.stub as never, storage.storage);
    const created = await service.createUpload('user_1', {
      purpose: 'CAMPAIGN_PHOTO',
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 2048,
    });
    await expect(service.getForUser('user_other', created.assetId)).rejects.toBeInstanceOf(
      ProblemError,
    );
  });

  it('404 on missing id', async () => {
    const prisma = makePrismaStub();
    const storage = makeStorageStub();
    const service = new MediaService(prisma.stub as never, storage.storage);
    await expect(service.getForUser('user_1', 'nope')).rejects.toBeInstanceOf(ProblemError);
  });
});
