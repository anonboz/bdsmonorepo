'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { type Campaign, createCampaignSchema } from '@repo/shared';
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

import { ApiError, api } from '../../../../../../../../lib/api';

interface FormValues {
  title: string;
  body: string;
  price: number;
  currency: string;
  photos: string;
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

  const form = useForm<FormValues>({
    // Reuse the input schema for client-side hints but transform photos at submit.
    resolver: zodResolver(createCampaignSchema.omit({ photos: true, expiresAt: true })),
    defaultValues: {
      title: initial?.title ?? '',
      body: initial?.body ?? '',
      price: initial?.price ?? 0,
      currency: initial?.currency ?? 'VND',
      photos: initial?.photos.join(', ') ?? '',
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const photos = values.photos
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

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
        label="Photo URLs"
        htmlFor="photos"
        description="Comma-separated list. Upload widget lands later."
      >
        <Textarea
          id="photos"
          rows={2}
          {...form.register('photos')}
          placeholder="https://…/p1.jpg, https://…/p2.jpg"
        />
      </FormField>

      <div className="flex gap-3">
        <Button type="submit" disabled={form.formState.isSubmitting}>
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
