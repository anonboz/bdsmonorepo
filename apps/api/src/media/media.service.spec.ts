import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_UPLOAD_BYTES } from '@repo/shared';

import { IMAGE_PROCESSOR, MediaService, type ImageProcessor } from './media.service.js';
import type { AuditLogger } from '../common/audit/audit-logger.service.js';
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
  status: 'PENDING' | 'UPLOADED' | 'DELETED' | 'REJECTED';
  provider: 's3';
  bucket: string;
  key: string;
  publicUrl: string;
  thumbnailUrl: string | null;
  thumbnailKey: string | null;
  processedAt: Date | null;
  processingFailureReason: string | null;
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
          thumbnailUrl: null,
          thumbnailKey: null,
          processedAt: null,
          processingFailureReason: null,
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
      updateMany: vi.fn(
        ({ where, data }: { where: { id: string; processedAt: null }; data: Partial<Row> }) => {
          const row = rows.find((r) => r.id === where.id && r.processedAt === null);
          if (row) Object.assign(row, data, { updatedAt: new Date() });
          return Promise.resolve({ count: row ? 1 : 0 });
        },
      ),
    },
  };
  return { stub, rows };
}

function makeStorageStub(opts: { head?: HeadObjectResult | null; bytes?: Buffer | null } = {}) {
  const presigned: PresignPutResult = {
    url: 'https://s3.test/uploads/signed?sig=abc',
    expiresAt: new Date(Date.now() + 300_000),
    requiredHeaders: { 'Content-Type': 'image/jpeg' },
  };
  const presignPut = vi.fn((_input: PresignPutInput) => Promise.resolve(presigned));
  const headResult: HeadObjectResult | null = 'head' in opts ? opts.head! : { sizeBytes: 1024 };
  const headObject = vi.fn(() => Promise.resolve(headResult));
  const bytes: Buffer | null = 'bytes' in opts ? opts.bytes! : Buffer.from('fake-image-bytes');
  const getObject = vi.fn(() => Promise.resolve(bytes));
  const putObject = vi.fn(() => Promise.resolve());
  const deleteObject = vi.fn(() => Promise.resolve());
  const publicUrl = vi.fn((bucket: string, key: string) => `https://cdn.test/${bucket}/${key}`);
  const buildKey = vi.fn(
    (i: { purpose: string; ownerUserId: string; assetId: string; filename: string }) =>
      `${i.purpose.toLowerCase()}/${i.ownerUserId}/${i.assetId}/${i.filename}`,
  );
  const storage = {
    bucketUploads: 'bds-uploads',
    presignPut,
    headObject,
    getObject,
    putObject,
    deleteObject,
    publicUrl,
    buildKey,
  } as unknown as StorageService;
  return { storage, presignPut, headObject, getObject, putObject, deleteObject, publicUrl };
}

function makeQueueStub() {
  const adds: { name: string; data: unknown; opts?: unknown }[] = [];
  const queue = {
    add: vi.fn((name: string, data: unknown, opts?: unknown) => {
      adds.push({ name, data, opts });
      return Promise.resolve({ id: `job_${adds.length}` });
    }),
  };
  return { queue, adds };
}

function makeAuditStub(): { audit: AuditLogger; calls: { action: string; meta?: unknown }[] } {
  const calls: { action: string; meta?: unknown }[] = [];
  const audit = {
    write: vi.fn((_tx: unknown, entry: { action: string; meta?: unknown }) => {
      calls.push({ action: entry.action, meta: entry.meta });
      return Promise.resolve();
    }),
    writeOnce: vi.fn((entry: { action: string; meta?: unknown }) => {
      calls.push({ action: entry.action, meta: entry.meta });
      return Promise.resolve();
    }),
  };
  return { audit: audit as unknown as AuditLogger, calls };
}

interface ProcessorStub extends ImageProcessor {
  stripExif: ReturnType<typeof vi.fn>;
  thumbnail: ReturnType<typeof vi.fn>;
}

function makeProcessorStub(opts: { stripped?: Buffer; thumbnail?: Buffer } = {}): ProcessorStub {
  return {
    stripExif: vi.fn(() => Promise.resolve(opts.stripped ?? Buffer.from('stripped-bytes-small'))),
    thumbnail: vi.fn(() => Promise.resolve(opts.thumbnail ?? Buffer.from('thumb'))),
  };
}

function makeService(
  prisma: ReturnType<typeof makePrismaStub>,
  storage: ReturnType<typeof makeStorageStub>,
  overrides: {
    queue?: ReturnType<typeof makeQueueStub>;
    audit?: ReturnType<typeof makeAuditStub>;
    processor?: ImageProcessor;
  } = {},
): MediaService {
  const queue = overrides.queue ?? makeQueueStub();
  const audit = overrides.audit ?? makeAuditStub();
  const processor = overrides.processor ?? makeProcessorStub();
  return new MediaService(
    prisma.stub as never,
    storage.storage,
    queue.queue as never,
    processor,
    audit.audit,
  );
}

describe('MediaService.createUpload', () => {
  let prisma: ReturnType<typeof makePrismaStub>;
  let storage: ReturnType<typeof makeStorageStub>;
  let service: MediaService;

  beforeEach(() => {
    prisma = makePrismaStub();
    storage = makeStorageStub();
    service = makeService(prisma, storage);
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
  it('verifies the object via headObject, flips to UPLOADED, and enqueues media.process', async () => {
    const prisma = makePrismaStub();
    const storage = makeStorageStub({ head: { sizeBytes: 1024 } });
    const queue = makeQueueStub();
    const service = makeService(prisma, storage, { queue });
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
    expect(queue.adds).toHaveLength(1);
    expect(queue.adds[0]).toMatchObject({
      name: 'process',
      data: { assetId: created.assetId },
    });
  });

  it('422 media.upload_not_found when the blob is absent', async () => {
    const prisma = makePrismaStub();
    const storage = makeStorageStub({ head: null });
    const service = makeService(prisma, storage);
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
    const service = makeService(prisma, storage);
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

  it('is idempotent on a second confirm — returns the row without re-heading + does not double-enqueue', async () => {
    const prisma = makePrismaStub();
    const storage = makeStorageStub({ head: { sizeBytes: 1024 } });
    const queue = makeQueueStub();
    const service = makeService(prisma, storage, { queue });
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
    // Only one enqueue across both confirms — the second short-circuits.
    expect(queue.adds).toHaveLength(1);
  });

  it('404 on cross-user confirm (existence-hiding)', async () => {
    const prisma = makePrismaStub();
    const storage = makeStorageStub();
    const service = makeService(prisma, storage);
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
    const service = makeService(prisma, storage);
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
    const service = makeService(prisma, storage);
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
    const service = makeService(prisma, storage);
    await expect(service.getForUser('user_1', 'nope')).rejects.toBeInstanceOf(ProblemError);
  });
});

// ---- Phase 10.3 — processAsset ------------------------------------

async function seedUploadedRow(
  prisma: ReturnType<typeof makePrismaStub>,
  storage: ReturnType<typeof makeStorageStub>,
  service: MediaService,
  ownerUserId = 'user_1',
): Promise<Row> {
  const created = await service.createUpload(ownerUserId, {
    purpose: 'CAMPAIGN_PHOTO',
    filename: 'photo.jpg',
    contentType: 'image/jpeg',
    sizeBytes: 2048,
  });
  await service.confirmUpload(ownerUserId, created.assetId);
  const row = prisma.rows.find((r) => r.id === created.assetId);
  if (!row) throw new Error('seed failed');
  // confirmUpload's queue.add was the producer-side; tests only care
  // about the result of the worker path.
  storage.getObject.mockClear();
  storage.putObject.mockClear();
  storage.deleteObject.mockClear();
  return row;
}

describe('MediaService.processAsset', () => {
  it('strips EXIF, writes stripped + thumbnail to S3, sets thumbnailUrl + processedAt', async () => {
    const prisma = makePrismaStub();
    const storage = makeStorageStub({ head: { sizeBytes: 1024 } });
    const audit = makeAuditStub();
    const processor = makeProcessorStub({
      stripped: Buffer.from('clean-source'),
      thumbnail: Buffer.from('mini'),
    });
    const service = makeService(prisma, storage, { audit, processor });
    const row = await seedUploadedRow(prisma, storage, service);

    const result = await service.processAsset(row.id);

    expect(result.status).toBe('processed');
    if (result.status === 'processed') {
      expect(result.thumbnailKey).toBe(`${row.key}.thumb.jpg`);
    }
    expect(processor.stripExif).toHaveBeenCalledOnce();
    expect(processor.thumbnail).toHaveBeenCalledOnce();
    // Two PutObject calls: stripped source + thumbnail. Original key
    // gets overwritten; thumbnail goes to `${key}.thumb.jpg`.
    expect(storage.putObject).toHaveBeenCalledTimes(2);
    const putCalls = storage.putObject.mock.calls as unknown as { key: string }[][];
    const putKeys = putCalls.map((args) => args[0]!.key);
    expect(putKeys).toContain(row.key);
    expect(putKeys).toContain(`${row.key}.thumb.jpg`);

    const after = prisma.rows.find((r) => r.id === row.id);
    expect(after?.thumbnailUrl).toBe(`https://cdn.test/bds-uploads/${row.key}.thumb.jpg`);
    expect(after?.thumbnailKey).toBe(`${row.key}.thumb.jpg`);
    expect(after?.processedAt).toBeInstanceOf(Date);
    expect(after?.status).toBe('UPLOADED');
    expect(after?.sizeBytes).toBe(Buffer.from('clean-source').length);
    expect(audit.calls.map((c) => c.action)).toEqual(['media.process.completed']);
  });

  it('rejects when stripped bytes exceed MAX_UPLOAD_BYTES: S3 delete + status REJECTED', async () => {
    const prisma = makePrismaStub();
    const storage = makeStorageStub({ head: { sizeBytes: 1024 } });
    const audit = makeAuditStub();
    const oversize = Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0x42);
    const processor = makeProcessorStub({ stripped: oversize });
    const service = makeService(prisma, storage, { audit, processor });
    const row = await seedUploadedRow(prisma, storage, service);

    const result = await service.processAsset(row.id);

    expect(result.status).toBe('rejected');
    expect(processor.thumbnail).not.toHaveBeenCalled();
    expect(storage.deleteObject).toHaveBeenCalledOnce();
    expect(storage.putObject).not.toHaveBeenCalled();

    const after = prisma.rows.find((r) => r.id === row.id);
    expect(after?.status).toBe('REJECTED');
    expect(after?.processedAt).toBeInstanceOf(Date);
    expect(after?.processingFailureReason).toContain('exceed');
    expect(after?.thumbnailUrl).toBeNull();
    expect(audit.calls.map((c) => c.action)).toEqual(['media.process.rejected']);
  });

  it('already-processed rows return without doing any work', async () => {
    const prisma = makePrismaStub();
    const storage = makeStorageStub({ head: { sizeBytes: 1024 } });
    const processor = makeProcessorStub();
    const service = makeService(prisma, storage, { processor });
    const row = await seedUploadedRow(prisma, storage, service);
    // Pretend the worker already finished this row.
    row.processedAt = new Date();
    row.thumbnailUrl = 'https://cdn.test/already';

    const result = await service.processAsset(row.id);
    expect(result.status).toBe('already-processed');
    expect(processor.stripExif).not.toHaveBeenCalled();
    expect(storage.getObject).not.toHaveBeenCalled();
  });

  it('not-found for an unknown id', async () => {
    const prisma = makePrismaStub();
    const storage = makeStorageStub();
    const service = makeService(prisma, storage);
    const result = await service.processAsset('media_does_not_exist');
    expect(result.status).toBe('not-found');
  });

  it('skips PENDING rows (worker fired before confirm somehow committed)', async () => {
    const prisma = makePrismaStub();
    const storage = makeStorageStub();
    const service = makeService(prisma, storage);
    const created = await service.createUpload('user_1', {
      purpose: 'CAMPAIGN_PHOTO',
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 2048,
    });
    const result = await service.processAsset(created.assetId);
    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') {
      expect(result.reason).toContain('PENDING');
    }
  });

  it('skips when the S3 source is missing (e.g. GDPR-erased mid-process)', async () => {
    const prisma = makePrismaStub();
    const storage = makeStorageStub({ head: { sizeBytes: 1024 }, bytes: null });
    const service = makeService(prisma, storage);
    const row = await seedUploadedRow(prisma, storage, service);

    const result = await service.processAsset(row.id);
    expect(result.status).toBe('skipped');
    const after = prisma.rows.find((r) => r.id === row.id);
    expect(after?.processedAt).toBeNull();
  });
});

describe('MediaService.markProcessingFailed', () => {
  it('lands the error reason on the row and stamps processedAt', async () => {
    const prisma = makePrismaStub();
    const storage = makeStorageStub();
    const service = makeService(prisma, storage);
    const row = await seedUploadedRow(prisma, storage, service);

    await service.markProcessingFailed(row.id, 'sharp threw: bad jpeg header');
    const after = prisma.rows.find((r) => r.id === row.id);
    expect(after?.processingFailureReason).toBe('sharp threw: bad jpeg header');
    expect(after?.processedAt).toBeInstanceOf(Date);
  });

  it('is a no-op when the row was already processed', async () => {
    const prisma = makePrismaStub();
    const storage = makeStorageStub();
    const service = makeService(prisma, storage);
    const row = await seedUploadedRow(prisma, storage, service);
    row.processedAt = new Date('2026-01-01');
    row.processingFailureReason = null;

    await service.markProcessingFailed(row.id, 'late failure event');
    const after = prisma.rows.find((r) => r.id === row.id);
    expect(after?.processingFailureReason).toBeNull();
    expect(after?.processedAt?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});

// ---- Sanity: IMAGE_PROCESSOR token is exported for module wiring --

describe('IMAGE_PROCESSOR', () => {
  it('is a symbol token (so module providers can match by identity)', () => {
    expect(typeof IMAGE_PROCESSOR).toBe('symbol');
  });
});
