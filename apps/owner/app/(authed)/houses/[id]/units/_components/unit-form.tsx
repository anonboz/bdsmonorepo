'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { createUnitSchema, type Unit } from '@repo/shared';
import { Alert, AlertDescription, AlertTitle, Button, FormField, Input, Spinner } from '@repo/ui';

import { ApiError, api } from '../../../../../../lib/api';

type FormValues = z.infer<typeof createUnitSchema>;

export interface UnitFormProps {
  houseId: string;
  /** When set, PATCH this unit; otherwise POST a new one. */
  initial?: Unit;
}

const STATUS_OPTIONS = ['VACANT', 'OCCUPIED', 'MAINTENANCE'] as const;

export function UnitForm({ houseId, initial }: UnitFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(createUnitSchema),
    defaultValues: initial
      ? {
          label: initial.label,
          status: initial.status,
          floor: initial.floor ?? undefined,
          sqm: initial.sqm ?? undefined,
          bedrooms: initial.bedrooms ?? undefined,
          bathrooms: initial.bathrooms ?? undefined,
        }
      : { label: '', status: 'VACANT' },
  });

  const onSubmit = form.handleSubmit(async (raw) => {
    // Coerce blank optional number inputs to undefined so the API doesn't
    // try to parse "" → NaN.
    const payload: FormValues = {
      ...raw,
      floor: numOrUndefined(raw.floor),
      sqm: numOrUndefined(raw.sqm),
      bedrooms: numOrUndefined(raw.bedrooms),
      bathrooms: numOrUndefined(raw.bathrooms),
    };

    try {
      const saved = initial
        ? await api.patch<Unit>(`/v1/houses/${houseId}/units/${initial.id}`, payload)
        : await api.post<Unit>(`/v1/houses/${houseId}/units`, payload);
      router.push(`/houses/${houseId}/units/${saved.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : 'Save failed.');
    }
  });

  return (
    <form className="space-y-6" onSubmit={onSubmit}>
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Save failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <FormField label="Label" htmlFor="label" error={form.formState.errors.label}>
        <Input id="label" autoComplete="off" {...form.register('label')} />
      </FormField>

      <FormField label="Status" htmlFor="status" error={form.formState.errors.status}>
        <select
          id="status"
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          {...form.register('status')}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s[0] + s.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
      </FormField>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Bedrooms" htmlFor="bedrooms" error={form.formState.errors.bedrooms}>
          <Input
            id="bedrooms"
            type="number"
            min={0}
            {...form.register('bedrooms', { valueAsNumber: true })}
          />
        </FormField>
        <FormField label="Bathrooms" htmlFor="bathrooms" error={form.formState.errors.bathrooms}>
          <Input
            id="bathrooms"
            type="number"
            min={0}
            {...form.register('bathrooms', { valueAsNumber: true })}
          />
        </FormField>
        <FormField label="Size (m²)" htmlFor="sqm" error={form.formState.errors.sqm}>
          <Input
            id="sqm"
            type="number"
            min={1}
            {...form.register('sqm', { valueAsNumber: true })}
          />
        </FormField>
        <FormField label="Floor" htmlFor="floor" error={form.formState.errors.floor}>
          <Input id="floor" type="number" {...form.register('floor', { valueAsNumber: true })} />
        </FormField>
      </div>

      <div className="flex gap-3">
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting && <Spinner />}
          {initial ? 'Save changes' : 'Create unit'}
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

function numOrUndefined(v: number | undefined): number | undefined {
  return v == null || Number.isNaN(v) ? undefined : v;
}
