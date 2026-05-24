'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { requestOtpSchema, verifyOtpSchema } from '@repo/shared';
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

import { ApiError, api } from '../../lib/api';
import { POST_LOGIN_PATH } from '../../lib/app-config';

type RequestForm = z.infer<typeof requestOtpSchema>;
type VerifyForm = z.infer<typeof verifyOtpSchema>;

type Step = { kind: 'request' } | { kind: 'verify'; identifier: string };

export function LoginForm() {
  const t = useTranslations('partner.login');
  const [step, setStep] = useState<Step>({ kind: 'request' });
  const [error, setError] = useState<string | null>(null);

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        {error && (
          <Alert variant="destructive">
            <AlertTitle>{t('failedTitle')}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {step.kind === 'request' ? (
          <RequestStep
            onSent={(identifier) => {
              setError(null);
              setStep({ kind: 'verify', identifier });
            }}
            onError={setError}
          />
        ) : (
          <VerifyStep
            identifier={step.identifier}
            onChangeIdentifier={() => {
              setError(null);
              setStep({ kind: 'request' });
            }}
            onError={setError}
          />
        )}
      </CardContent>
    </Card>
  );
}

function RequestStep({
  onSent,
  onError,
}: {
  onSent: (identifier: string) => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations('partner.login.form');
  const form = useForm<RequestForm>({
    resolver: zodResolver(requestOtpSchema),
    defaultValues: { identifier: '' },
  });

  return (
    <form
      className="space-y-4"
      onSubmit={form.handleSubmit(async (values) => {
        try {
          await api.post('/v1/auth/email-otp/send-verification-otp', {
            email: values.identifier,
            type: 'sign-in',
          });
          onSent(values.identifier);
        } catch (err) {
          onError(err instanceof ApiError ? err.problem.title : t('couldNotSend'));
        }
      })}
    >
      <FormField
        label={t('emailLabel')}
        htmlFor="identifier"
        error={form.formState.errors.identifier}
        description={t('emailDescription')}
      >
        <Input
          id="identifier"
          type="email"
          autoComplete="email"
          inputMode="email"
          {...form.register('identifier')}
        />
      </FormField>
      <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting && <Spinner />}
        {t('sendCode')}
      </Button>
    </form>
  );
}

function VerifyStep({
  identifier,
  onChangeIdentifier,
  onError,
}: {
  identifier: string;
  onChangeIdentifier: () => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations('partner.login.form');
  const form = useForm<VerifyForm>({
    resolver: zodResolver(verifyOtpSchema),
    defaultValues: { identifier, code: '' },
  });

  return (
    <form
      className="space-y-4"
      onSubmit={form.handleSubmit(async (values) => {
        try {
          await api.post('/v1/auth/sign-in/email-otp', {
            email: values.identifier,
            otp: values.code,
          });
          window.location.assign(POST_LOGIN_PATH);
        } catch (err) {
          onError(err instanceof ApiError ? err.problem.title : t('invalidCode'));
        }
      })}
    >
      <p className="text-sm text-muted-foreground">
        {t.rich('codeSentTo', {
          email: identifier,
          strong: (chunks) => <strong>{chunks}</strong>,
        })}{' '}
        <button type="button" className="underline" onClick={onChangeIdentifier}>
          {t('change')}
        </button>
      </p>
      <FormField label={t('codeLabel')} htmlFor="code" error={form.formState.errors.code}>
        <Input
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          {...form.register('code')}
        />
      </FormField>
      <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting && <Spinner />}
        {t('verify')}
      </Button>
    </form>
  );
}
