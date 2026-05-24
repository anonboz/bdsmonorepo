'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('owner.campaigns.form');
  const tChrome = useTranslations('owner.chrome');
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
      setError(err instanceof ApiError ? err.problem.title : t('failed'));
    }
  });

  return (
    <form className="space-y-6" onSubmit={onSubmit}>
      {error && (
        <Alert variant="destructive">
          <AlertTitle>{t('failedTitle')}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <FormField label={t('titleLabel')} htmlFor="title" error={form.formState.errors.title}>
        <Input id="title" {...form.register('title')} placeholder={t('titlePlaceholder')} />
      </FormField>

      <FormField
        label={t('descriptionLabel')}
        htmlFor="body"
        description={t('descriptionHelp')}
        error={form.formState.errors.body}
      >
        <Textarea id="body" rows={6} {...form.register('body')} />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label={t('priceLabel')}
          htmlFor="price"
          description={t('priceHelp')}
          error={form.formState.errors.price}
        >
          <Input
            id="price"
            type="number"
            min={0}
            {...form.register('price', { valueAsNumber: true })}
          />
        </FormField>

        <FormField
          label={t('currencyLabel')}
          htmlFor="currency"
          error={form.formState.errors.currency}
        >
          <Input id="currency" maxLength={3} {...form.register('currency')} />
        </FormField>
      </div>

      <FormField label={t('photosLabel')} htmlFor="campaign-photos" description={t('photosHelp')}>
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
          {mode === 'create' ? t('createButton') : tChrome('saveChanges')}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={form.formState.isSubmitting}
        >
          {tChrome('cancel')}
        </Button>
      </div>
    </form>
  );
}
