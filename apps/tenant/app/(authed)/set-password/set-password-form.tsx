'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { setPasswordSchema } from '@repo/shared';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  FormField,
  Input,
  Spinner,
} from '@repo/ui';

import { api } from '../../../lib/api';
import { POST_LOGIN_PATH } from '../../../lib/app-config';

// Extend the shared schema with a local confirm field. The match check
// runs in onSubmit so its message can be localized.
const formSchema = setPasswordSchema.extend({ confirm: z.string().min(1) });
type FormValues = z.infer<typeof formSchema>;

export function SetPasswordForm() {
  const t = useTranslations('tenant.setPassword.form');
  const [error, setError] = useState<string | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { newPassword: '', confirm: '' },
  });

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        {error && (
          <Alert variant="destructive">
            <AlertTitle>{t('failedTitle')}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit(async (values) => {
            if (values.newPassword !== values.confirm) {
              form.setError('confirm', { message: t('mismatch') });
              return;
            }
            try {
              await api.post('/v1/me/set-password', { newPassword: values.newPassword });
              window.location.assign(POST_LOGIN_PATH);
            } catch {
              setError(t('couldNotSet'));
            }
          })}
        >
          <FormField
            label={t('passwordLabel')}
            htmlFor="newPassword"
            error={form.formState.errors.newPassword}
            description={t('passwordDescription')}
          >
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              {...form.register('newPassword')}
            />
          </FormField>
          <FormField
            label={t('confirmLabel')}
            htmlFor="confirm"
            error={form.formState.errors.confirm}
          >
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              {...form.register('confirm')}
            />
          </FormField>
          <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Spinner />}
            {t('submit')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
