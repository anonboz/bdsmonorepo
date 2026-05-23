'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import type { Campaign, CreateMediaUploadResponse, MediaAsset } from '@repo/shared';
import { createCampaignSchema } from '@repo/shared';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  FormField,
  Input,
  MediaUploader,
  Spinner,
  Textarea,
} from '@repo/ui';

import { ApiError, api } from '../../../../../../../../lib/api';

/** Concrete uploader-client bound to this app's typed api wrapper. */
const uploaderClient = {
  createUpload: (body: {
    purpose: 'CAMPAIGN_PHOTO' | 'JOB_PROOF';
    filename: string;
    contentType: string;
    sizeBytes: number;
  }) => api.post<CreateMediaUploadResponse>('/v1/media/uploads', body),
  confirmUpload: (assetId: string) => api.post<MediaAsset>(`/v1/media/uploads/${assetId}/confirm`),
};

interface FormValues {
  title: string;
  body: string;
  price: number;
  currency: string;
}

/**
 * Single form used for both create and DRAFT edit. The `photos` field is
 * a comma-separated URL list — Phase 4.3+ will swap in an upload widget
 * once S3 is wired.
 */
export function CampaignForm({
  houseId,
  unitId,
  mode,
  initial,
}: {
  houseId: string;
  unitId: string;
  mode: 'create' | 'edit';
  initial?: Campaign;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<string[]>(initial?.photos ?? []);
  const [uploaderBusy, setUploaderBusy] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(createCampaignSchema.omit({ photos: true, expiresAt: true })),
    defaultValues: {
      title: initial?.title ?? '',
      body: initial?.body ?? '',
      price: initial?.price ?? 0,
      currency: initial?.currency ?? 'VND',
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);

    const payload = {
      title: values.title,
      body: values.body,
      price: Number(values.price),
      currency: values.currency,
      photos,
    };

    try {
      if (mode === 'create') {
        const created = await api.post<Campaign>(
          `/v1/houses/${houseId}/units/${unitId}/campaigns`,
          payload,
        );
        router.push(`/houses/${houseId}/units/${unitId}/campaigns/${created.id}`);
        router.refresh();
      } else {
        if (!initial) throw new Error('initial campaign required for edit');
        await api.patch<Campaign>(
          `/v1/houses/${houseId}/units/${unitId}/campaigns/${initial.id}`,
          payload,
        );
        router.push(`/houses/${houseId}/units/${unitId}/campaigns/${initial.id}`);
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : 'Could not save campaign.');
    }
  });

  return (
    <form className="space-y-6" onSubmit={onSubmit}>
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Could not save campaign</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <FormField label="Title" htmlFor="title" error={form.formState.errors.title}>
        <Input id="title" {...form.register('title')} placeholder="Cozy studio near metro" />
      </FormField>

      <FormField
        label="Description"
        htmlFor="body"
        description="Visible publicly once admin approves."
        error={form.formState.errors.body}
      >
        <Textarea id="body" rows={6} {...form.register('body')} />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Price (minor units)"
          htmlFor="price"
          description="e.g. 5000000 = ₫5,000,000."
          error={form.formState.errors.price}
        >
          <Input
            id="price"
            type="number"
            min={0}
            {...form.register('price', { valueAsNumber: true })}
          />
        </FormField>

        <FormField label="Currency" htmlFor="currency" error={form.formState.errors.currency}>
          <Input id="currency" maxLength={3} {...form.register('currency')} />
        </FormField>
      </div>

      <FormField
        label="Photos"
        htmlFor="campaign-photos"
        description="Up to 20 images. Uploaded directly to our storage."
      >
        <div id="campaign-photos">
          <MediaUploader
            purpose="CAMPAIGN_PHOTO"
            initial={photos}
            maxFiles={20}
            onChange={setPhotos}
            onBusyChange={setUploaderBusy}
            apiClient={uploaderClient}
          />
        </div>
      </FormField>

      <div className="flex gap-3">
        <Button type="submit" disabled={form.formState.isSubmitting || uploaderBusy}>
          {form.formState.isSubmitting && <Spinner />}
          {mode === 'create' ? 'Create draft' : 'Save changes'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={form.formState.isSubmitting}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
