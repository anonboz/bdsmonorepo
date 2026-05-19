'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { createTicketSchema, type Lease, type Ticket } from '@repo/shared';
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

type FormValues = z.infer<typeof createTicketSchema>;

const CATEGORY_OPTIONS = ['REPAIR', 'REPORT', 'COMPLAINT', 'REQUEST', 'OTHER'] as const;

export function NewTicketForm({ leases }: { leases: Lease[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(createTicketSchema),
    defaultValues: {
      leaseId: leases[0]?.id ?? '',
      category: 'REPAIR',
      title: '',
      body: '',
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const t = await api.post<Ticket>('/v1/me/tickets', values);
      router.push(`/my-tickets/${t.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : 'Could not raise ticket.');
    }
  });

  return (
    <form className="space-y-6" onSubmit={onSubmit}>
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Could not raise ticket</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <FormField label="Lease" htmlFor="leaseId" error={form.formState.errors.leaseId}>
        <select
          id="leaseId"
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          {...form.register('leaseId')}
        >
          {leases.map((l) => (
            <option key={l.id} value={l.id}>
              {l.rentCycle.toLowerCase()} · {l.currency} · started {l.startDate}
            </option>
          ))}
        </select>
      </FormField>

      <FormField label="Category" htmlFor="category" error={form.formState.errors.category}>
        <select
          id="category"
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          {...form.register('category')}
        >
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {c[0] + c.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
      </FormField>

      <FormField label="Title" htmlFor="title" error={form.formState.errors.title}>
        <Input id="title" {...form.register('title')} placeholder="Brief summary" />
      </FormField>

      <FormField
        label="Details"
        htmlFor="body"
        error={form.formState.errors.body}
        description="What happened, when, and what should we do about it."
      >
        <Textarea id="body" rows={6} {...form.register('body')} />
      </FormField>

      <div className="flex gap-3">
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting && <Spinner />}
          Raise ticket
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
