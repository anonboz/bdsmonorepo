'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { createServiceSchema, type Service } from '@repo/shared';
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

import { ApiError, api } from '../../../../lib/api';

interface FormValues {
  name: string;
  description: string;
  basePrice: number;
  currency: string;
  isActive: boolean;
}

export function ServiceForm({ mode, initial }: { mode: 'create' | 'edit'; initial?: Service }) {
  const t = useTranslations('partner.services.form');
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(
      createServiceSchema.partial({ description: true }).extend(
        // Keep `description` as a string in the form even when optional in API.
        { description: createServiceSchema.shape.description.optional() } as never,
      ),
    ),
    defaultValues: {
      name: initial?.name ?? '',
      description: initial?.description ?? '',
      basePrice: initial?.basePrice ?? 0,
      currency: initial?.currency ?? 'VND',
      isActive: initial?.isActive ?? true,
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const payload = {
      name: values.name,
      description: values.description?.trim() || undefined,
      basePrice: Number(values.basePrice),
      currency: values.currency,
      isActive: values.isActive,
    };
    try {
      if (mode === 'create') {
        const created = await api.post<Service>('/v1/me/services', payload);
        router.push(`/services/${created.id}`);
        router.refresh();
      } else {
        if (!initial) throw new Error('initial required for edit');
        await api.patch<Service>(`/v1/me/services/${initial.id}`, payload);
        router.push(`/services/${initial.id}`);
        router.refresh();
      }
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

      <FormField label={t('nameLabel')} htmlFor="name" error={form.formState.errors.name}>
        <Input id="name" {...form.register('name')} placeholder={t('namePlaceholder')} />
      </FormField>

      <FormField
        label={t('descriptionLabel')}
        htmlFor="description"
        description={t('descriptionDescription')}
      >
        <Textarea id="description" rows={4} {...form.register('description')} />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label={t('basePriceLabel')}
          htmlFor="basePrice"
          description={t('basePriceDescription')}
          error={form.formState.errors.basePrice}
        >
          <Input
            id="basePrice"
            type="number"
            min={0}
            {...form.register('basePrice', { valueAsNumber: true })}
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

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" {...form.register('isActive')} />
        {t('activeLabel')}
      </label>

      <div className="flex gap-3">
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting && <Spinner />}
          {mode === 'create' ? t('createButton') : t('saveButton')}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={form.formState.isSubmitting}
        >
          {t('cancelButton')}
        </Button>
      </div>
    </form>
  );
}
