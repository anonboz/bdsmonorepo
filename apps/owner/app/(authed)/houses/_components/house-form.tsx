'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { createHouseSchema, type House } from '@repo/shared';
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

type FormValues = z.infer<typeof createHouseSchema>;

export interface HouseFormProps {
  /** When provided, the form edits this house via PATCH. Otherwise POSTs a new one. */
  initial?: House;
  /** Where to send the user after a successful save. Defaults to /houses/<id>. */
  redirectTo?: string;
}

const DEFAULTS: FormValues = {
  name: '',
  description: '',
  address: {
    line1: '',
    line2: '',
    city: '',
    state: '',
    postalCode: '',
    country: 'VN',
  },
  isPublished: false,
};

export function HouseForm({ initial, redirectTo }: HouseFormProps) {
  const t = useTranslations('owner.houses.form');
  const tChrome = useTranslations('owner.chrome');
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(createHouseSchema),
    defaultValues: initial
      ? {
          name: initial.name,
          description: initial.description ?? '',
          address: {
            line1: initial.address.line1,
            line2: initial.address.line2 ?? '',
            city: initial.address.city,
            state: initial.address.state ?? '',
            postalCode: initial.address.postalCode ?? '',
            country: initial.address.country,
          },
          isPublished: initial.isPublished,
        }
      : DEFAULTS,
  });

  const onSubmit = form.handleSubmit(async (raw) => {
    const payload: FormValues = {
      ...raw,
      description: raw.description?.trim() ? raw.description.trim() : undefined,
      address: {
        ...raw.address,
        line2: raw.address.line2?.trim() ? raw.address.line2.trim() : undefined,
        state: raw.address.state?.trim() ? raw.address.state.trim() : undefined,
        postalCode: raw.address.postalCode?.trim() ? raw.address.postalCode.trim() : undefined,
      },
    };

    try {
      const saved = initial
        ? await api.patch<House>(`/v1/houses/${initial.id}`, payload)
        : await api.post<House>('/v1/houses', payload);
      router.push(redirectTo ?? `/houses/${saved.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : tChrome('saveFailed'));
    }
  });

  return (
    <form className="space-y-6" onSubmit={onSubmit}>
      {error && (
        <Alert variant="destructive">
          <AlertTitle>{tChrome('saveFailedTitle')}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <FormField label={t('nameLabel')} htmlFor="name" error={form.formState.errors.name}>
        <Input id="name" autoComplete="off" {...form.register('name')} />
      </FormField>

      <FormField
        label={t('descriptionLabel')}
        htmlFor="description"
        error={form.formState.errors.description}
        description={t('descriptionHelp')}
      >
        <Textarea id="description" {...form.register('description')} />
      </FormField>

      <fieldset className="space-y-4 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">{t('addressLegend')}</legend>

        <FormField
          label={t('streetLabel')}
          htmlFor="line1"
          error={form.formState.errors.address?.line1}
        >
          <Input id="line1" autoComplete="address-line1" {...form.register('address.line1')} />
        </FormField>

        <FormField
          label={t('aptLabel')}
          htmlFor="line2"
          error={form.formState.errors.address?.line2}
        >
          <Input id="line2" autoComplete="address-line2" {...form.register('address.line2')} />
        </FormField>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            label={t('cityLabel')}
            htmlFor="city"
            error={form.formState.errors.address?.city}
          >
            <Input id="city" autoComplete="address-level2" {...form.register('address.city')} />
          </FormField>
          <FormField
            label={t('stateLabel')}
            htmlFor="state"
            error={form.formState.errors.address?.state}
          >
            <Input id="state" autoComplete="address-level1" {...form.register('address.state')} />
          </FormField>
          <FormField
            label={t('postalCodeLabel')}
            htmlFor="postalCode"
            error={form.formState.errors.address?.postalCode}
          >
            <Input
              id="postalCode"
              autoComplete="postal-code"
              {...form.register('address.postalCode')}
            />
          </FormField>
          <FormField
            label={t('countryLabel')}
            htmlFor="country"
            error={form.formState.errors.address?.country}
            description={t('countryHelp')}
          >
            <Input
              id="country"
              autoComplete="country"
              maxLength={2}
              {...form.register('address.country')}
            />
          </FormField>
        </div>
      </fieldset>

      <label className="flex items-center gap-3 rounded-lg border p-4">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-input"
          {...form.register('isPublished')}
        />
        <div className="space-y-0.5">
          <p className="text-sm font-medium">{t('publishedLabel')}</p>
          <p className="text-xs text-muted-foreground">{t('publishedHelp')}</p>
        </div>
      </label>

      <div className="flex gap-3">
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting && <Spinner />}
          {initial ? tChrome('saveChanges') : t('createButton')}
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
