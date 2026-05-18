'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

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
import { requestOtpSchema, verifyOtpSchema } from '@repo/shared';
import type { z } from 'zod';

import { ApiError, api } from '../../lib/api.js';
import { POST_LOGIN_PATH } from '../../lib/app-config.js';

type RequestForm = z.infer<typeof requestOtpSchema>;
type VerifyForm = z.infer<typeof verifyOtpSchema>;

type Step = { kind: 'request' } | { kind: 'verify'; identifier: string };

export function LoginForm() {
  const [step, setStep] = useState<Step>({ kind: 'request' });
  const [error, setError] = useState<string | null>(null);

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Sign-in failed</AlertTitle>
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
          onError(err instanceof ApiError ? err.problem.title : 'Could not send code.');
        }
      })}
    >
      <FormField
        label="Email"
        htmlFor="identifier"
        error={form.formState.errors.identifier}
        description="We'll email you a 6-digit code."
      >
        <Input
          id="identifier"
          type="email"
          autoComplete="email"
          inputMode="email"
          autoFocus
          {...form.register('identifier')}
        />
      </FormField>
      <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting && <Spinner />}
        Send code
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
          onError(err instanceof ApiError ? err.problem.title : 'Invalid code.');
        }
      })}
    >
      <p className="text-sm text-muted-foreground">
        Code sent to <strong>{identifier}</strong>.{' '}
        <button type="button" className="underline" onClick={onChangeIdentifier}>
          Change
        </button>
      </p>
      <FormField label="6-digit code" htmlFor="code" error={form.formState.errors.code}>
        <Input
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          autoFocus
          {...form.register('code')}
        />
      </FormField>
      <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting && <Spinner />}
        Verify & sign in
      </Button>
    </form>
  );
}
