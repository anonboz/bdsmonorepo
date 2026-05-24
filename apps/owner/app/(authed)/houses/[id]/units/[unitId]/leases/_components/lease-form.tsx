'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { createLeaseSchema, emailSchema, type Lease, type UserLookup } from '@repo/shared';
import { Alert, AlertDescription, AlertTitle, Button, FormField, Input, Spinner } from '@repo/ui';

import { ApiError, api } from '../../../../../../../../lib/api';

const leaseFormSchema = createLeaseSchema.omit({ tenantId: true }).extend({
  tenantEmail: emailSchema,
});
type FormValues = z.infer<typeof leaseFormSchema>;

export interface LeaseFormProps {
  houseId: string;
  unitId: string;
  /** When set, PATCH this lease (DRAFT only). Otherwise POST a new draft. */
  initial?: Lease;
  /** Email pre-populated when editing — we don't refetch the user. */
  initialTenantEmail?: string;
}

export function LeaseForm({ houseId, unitId, initial, initialTenantEmail }: LeaseFormProps) {
  const t = useTranslations('owner.leases.form');
  const tChrome = useTranslations('owner.chrome');
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [resolvedTenant, setResolvedTenant] = useState<UserLookup | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(leaseFormSchema),
    defaultValues: initial
      ? {
          tenantEmail: initialTenantEmail ?? '',
          rentCycle: initial.rentCycle,
          rentAmount: initial.rentAmount,
          depositAmount: initial.depositAmount,
          currency: initial.currency,
          startDate: initial.startDate,
          endDate: initial.endDate ?? undefined,
        }
      : {
          tenantEmail: '',
          rentCycle: 'MONTHLY',
          rentAmount: 0,
          depositAmount: 0,
          currency: 'VND',
          startDate: new Date().toISOString().slice(0, 10),
        },
  });

  const tenantEmail = form.watch('tenantEmail');
  useEffect(() => {
    const trimmed = tenantEmail?.trim().toLowerCase();
    if (!trimmed || !/^\S+@\S+\.\S+$/.test(trimmed)) {
      setResolvedTenant(null);
      return;
    }
    const handle = setTimeout(() => {
      api
        .get<UserLookup>(`/v1/users/find?email=${encodeURIComponent(trimmed)}&role=TENANT`)
        .then((u) => setResolvedTenant(u))
        .catch(() => setResolvedTenant(null));
    }, 350);
    return () => clearTimeout(handle);
  }, [tenantEmail]);

  const onSubmit = form.handleSubmit(async (raw) => {
    setError(null);
    if (!resolvedTenant) {
      setError(t('tenantNotFound'));
      return;
    }
    const payload = {
      tenantId: resolvedTenant.id,
      rentCycle: raw.rentCycle,
      rentAmount: raw.rentAmount,
      depositAmount: raw.depositAmount,
      currency: raw.currency,
      startDate: raw.startDate,
      ...(raw.endDate && { endDate: raw.endDate }),
    };

    try {
      const saved = initial
        ? await api.patch<Lease>(
            `/v1/houses/${houseId}/units/${unitId}/leases/${initial.id}`,
            payload,
          )
        : await api.post<Lease>(`/v1/houses/${houseId}/units/${unitId}/leases`, payload);
      router.push(`/houses/${houseId}/units/${unitId}/leases/${saved.id}`);
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

      <FormField
        label={t('tenantEmailLabel')}
        htmlFor="tenantEmail"
        error={form.formState.errors.tenantEmail}
        description={
          resolvedTenant ? t('tenantFound', { name: resolvedTenant.displayName }) : t('tenantHint')
        }
      >
        <Input id="tenantEmail" type="email" autoComplete="off" {...form.register('tenantEmail')} />
      </FormField>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          label={t('rentLabel')}
          htmlFor="rentAmount"
          error={form.formState.errors.rentAmount}
        >
          <Input
            id="rentAmount"
            type="number"
            min={0}
            {...form.register('rentAmount', { valueAsNumber: true })}
          />
        </FormField>
        <FormField
          label={t('depositLabel')}
          htmlFor="depositAmount"
          error={form.formState.errors.depositAmount}
        >
          <Input
            id="depositAmount"
            type="number"
            min={0}
            {...form.register('depositAmount', { valueAsNumber: true })}
          />
        </FormField>
        <FormField
          label={t('currencyLabel')}
          htmlFor="currency"
          error={form.formState.errors.currency}
          description={t('currencyHelp')}
        >
          <Input id="currency" maxLength={3} {...form.register('currency')} />
        </FormField>
        <FormField
          label={t('cycleLabel')}
          htmlFor="rentCycle"
          error={form.formState.errors.rentCycle}
        >
          <select
            id="rentCycle"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            {...form.register('rentCycle')}
          >
            <option value="WEEKLY">{t('cycleWeekly')}</option>
            <option value="MONTHLY">{t('cycleMonthly')}</option>
            <option value="QUARTERLY">{t('cycleQuarterly')}</option>
            <option value="YEARLY">{t('cycleYearly')}</option>
          </select>
        </FormField>
        <FormField
          label={t('startDateLabel')}
          htmlFor="startDate"
          error={form.formState.errors.startDate}
        >
          <Input id="startDate" type="date" {...form.register('startDate')} />
        </FormField>
        <FormField
          label={t('endDateLabel')}
          htmlFor="endDate"
          error={form.formState.errors.endDate}
        >
          <Input id="endDate" type="date" {...form.register('endDate')} />
        </FormField>
      </div>

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
