'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
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
      setError(err instanceof ApiError ? err.problem.title : 'Could not save profile.');
    }
  });

  return (
    <form className="space-y-6" onSubmit={onSubmit}>
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {saved && (
        <Alert>
          <AlertTitle>Saved</AlertTitle>
          <AlertDescription>Your profile is up to date.</AlertDescription>
        </Alert>
      )}

      <FormField
        label="Business name"
        htmlFor="businessName"
        error={form.formState.errors.businessName}
      >
        <Input id="businessName" {...form.register('businessName')} placeholder="Bob's Plumbing" />
      </FormField>

      <FormField
        label="Bio"
        htmlFor="bio"
        description="What you do, years of experience, anything an owner should know."
        error={form.formState.errors.bio}
      >
        <Textarea id="bio" rows={4} {...form.register('bio')} />
      </FormField>

      <FormField
        label="Service area"
        htmlFor="serviceArea"
        description="Cities or districts you cover. Free-form for now."
        error={form.formState.errors.serviceArea}
      >
        <Input
          id="serviceArea"
          {...form.register('serviceArea')}
          placeholder="Hanoi, Hai Ba Trung"
        />
      </FormField>

      <Button type="submit" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting && <Spinner />}
        {initial ? 'Save changes' : 'Publish profile'}
      </Button>
    </form>
  );
}
