'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { phonePasswordSignInSchema, requestOtpSchema, verifyOtpSchema } from '@repo/shared';
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
import { AUTH_PASSWORD_ENABLED, POST_LOGIN_PATH } from '../../lib/app-config';

type RequestForm = z.infer<typeof requestOtpSchema>;
type VerifyForm = z.infer<typeof verifyOtpSchema>;
type PasswordForm = z.infer<typeof phonePasswordSignInSchema>;

type Step = { kind: 'request' } | { kind: 'verify'; identifier: string };
type Mode = 'code' | 'password';

export function LoginForm() {
  const [mode, setMode] = useState<Mode>('code');
  const [step, setStep] = useState<Step>({ kind: 'request' });
  const [error, setError] = useState<string | null>(null);

  const switchMode = (next: Mode) => {
    setError(null);
    setStep({ kind: 'request' });
    setMode(next);
  };

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        {AUTH_PASSWORD_ENABLED && <ModeToggle mode={mode} onChange={switchMode} />}
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Sign-in failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {AUTH_PASSWORD_ENABLED && mode === 'password' ? (
          <PasswordStep onError={setError} />
        ) : step.kind === 'request' ? (
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

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (next: Mode) => void }) {
  const labels: Record<Mode, string> = { code: 'Email code', password: 'Password' };
  return (
    <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Sign-in method">
      {(['code', 'password'] as const).map((m) => (
        <Button
          key={m}
          type="button"
          role="tab"
          aria-selected={mode === m}
          variant={mode === m ? 'default' : 'outline'}
          onClick={() => onChange(m)}
        >
          {labels[m]}
        </Button>
      ))}
    </div>
  );
}

function PasswordStep({ onError }: { onError: (msg: string) => void }) {
  const form = useForm<PasswordForm>({
    resolver: zodResolver(phonePasswordSignInSchema),
    defaultValues: { phoneNumber: '', password: '' },
  });

  return (
    <form
      className="space-y-4"
      onSubmit={form.handleSubmit(async (values) => {
        try {
          await api.post('/v1/auth/sign-in/phone-number', {
            phoneNumber: values.phoneNumber,
            password: values.password,
          });
          window.location.assign(POST_LOGIN_PATH);
        } catch {
          // better-auth returns its own error body here, not our Problem
          // shape — show a generic, enumeration-safe message either way.
          onError('Incorrect phone number or password.');
        }
      })}
    >
      <FormField
        label="Phone number"
        htmlFor="phoneNumber"
        error={form.formState.errors.phoneNumber}
        description="The phone number on your account, including country code."
      >
        <Input
          id="phoneNumber"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          placeholder="+84…"
          {...form.register('phoneNumber')}
        />
      </FormField>
      <FormField label="Password" htmlFor="password" error={form.formState.errors.password}>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          {...form.register('password')}
        />
      </FormField>
      <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting && <Spinner />}
        Sign in
      </Button>
    </form>
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
