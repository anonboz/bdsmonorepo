'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { type PartnerProfile, upsertPartnerProfileSchema } from '@repo/shared';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  FormField,
  Input,
  Spinner,
  Textarea,
} from '@repo/ui';

import { ApiError, api } from '../../../lib/api';

type FormValues = z.infer<typeof upsertPartnerProfileSchema>;

export function ProfileForm({ initial }: { initial: PartnerProfile | null }) {
  const t = useTranslations('partner.profile.form');
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(upsertPartnerProfileSchema),
    defaultValues: {
      businessName: initial?.businessName ?? '',
      bio: initial?.bio ?? '',
      serviceArea: initial?.serviceArea ?? '',
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    setSaved(false);
    try {
      await api.put<PartnerProfile>('/v1/me/partner-profile', values);
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : t('couldNotSave'));
    }
  });

  return (
    <form className="space-y-6" onSubmit={onSubmit}>
      {error && (
        <Alert variant="destructive">
          <AlertTitle>{t('couldNotSaveTitle')}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {saved && (
        <Alert>
          <AlertTitle>{t('savedTitle')}</AlertTitle>
          <AlertDescription>{t('savedBody')}</AlertDescription>
        </Alert>
      )}

      <FormField
        label={t('businessNameLabel')}
        htmlFor="businessName"
        error={form.formState.errors.businessName}
      >
        <Input
          id="businessName"
          {...form.register('businessName')}
          placeholder={t('businessNamePlaceholder')}
        />
      </FormField>

      <FormField
        label={t('bioLabel')}
        htmlFor="bio"
        description={t('bioDescription')}
        error={form.formState.errors.bio}
      >
        <Textarea id="bio" rows={4} {...form.register('bio')} />
      </FormField>

      <FormField
        label={t('serviceAreaLabel')}
        htmlFor="serviceArea"
        description={t('serviceAreaDescription')}
        error={form.formState.errors.serviceArea}
      >
        <Input
          id="serviceArea"
          {...form.register('serviceArea')}
          placeholder={t('serviceAreaPlaceholder')}
        />
      </FormField>

      <Button type="submit" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting && <Spinner />}
        {initial ? t('saveButton') : t('publishButton')}
      </Button>
    </form>
  );
}
