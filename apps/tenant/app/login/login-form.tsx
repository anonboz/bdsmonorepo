'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
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

// 'email' / 'phone' pick the OTP delivery channel; 'password' (Phase 12.6,
// gated by the flag) is a single-step phone + password sign-in.
type Mode = 'email' | 'phone' | 'password';
type Step = { kind: 'request' } | { kind: 'verify'; mode: Mode; identifier: string };

export function LoginForm() {
  const t = useTranslations('tenant.login');
  const [mode, setMode] = useState<Mode>('email');
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
          <>
            <ModeTabs
              mode={mode}
              onChange={(next) => {
                setError(null);
                setMode(next);
              }}
            />
            {mode === 'password' ? (
              <PasswordStep onError={setError} />
            ) : (
              <RequestStep
                key={mode}
                mode={mode}
                onSent={(identifier) => {
                  setError(null);
                  setStep({ kind: 'verify', mode, identifier });
                }}
                onError={setError}
              />
            )}
          </>
        ) : (
          <VerifyStep
            mode={step.mode}
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

function ModeTabs({ mode, onChange }: { mode: Mode; onChange: (next: Mode) => void }) {
  const t = useTranslations('tenant.login.form');
  const baseClass = 'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors';
  const activeClass = 'bg-background text-foreground shadow-sm';
  const inactiveClass = 'text-muted-foreground hover:text-foreground';
  const tabs: { value: Mode; label: string }[] = [
    { value: 'email', label: t('tabEmail') },
    { value: 'phone', label: t('tabPhone') },
    ...(AUTH_PASSWORD_ENABLED ? [{ value: 'password' as const, label: t('tabPassword') }] : []),
  ];
  return (
    <div
      role="tablist"
      aria-label={tabs.map((tab) => tab.label).join(' / ')}
      className="bg-muted text-muted-foreground inline-flex w-full items-center rounded-lg p-1"
    >
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={mode === tab.value}
          className={`${baseClass} ${mode === tab.value ? activeClass : inactiveClass}`}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function RequestStep({
  mode,
  onSent,
  onError,
}: {
  mode: Mode;
  onSent: (identifier: string) => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations('tenant.login.form');
  const form = useForm<RequestForm>({
    resolver: zodResolver(requestOtpSchema),
    defaultValues: { identifier: '' },
  });

  return (
    <form
      className="space-y-4"
      onSubmit={form.handleSubmit(async (values) => {
        try {
          if (mode === 'email') {
            await api.post('/v1/auth/email-otp/send-verification-otp', {
              email: values.identifier,
              type: 'sign-in',
            });
          } else {
            await api.post('/v1/auth/phone-number/send-otp', {
              phoneNumber: values.identifier,
            });
          }
          onSent(values.identifier);
        } catch (err) {
          onError(err instanceof ApiError ? err.problem.title : t('couldNotSend'));
        }
      })}
    >
      {mode === 'email' ? (
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
      ) : (
        <FormField
          label={t('phoneLabel')}
          htmlFor="identifier"
          error={form.formState.errors.identifier}
          description={t('phoneDescription')}
        >
          <Input
            id="identifier"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            placeholder="+84..."
            {...form.register('identifier')}
          />
        </FormField>
      )}
      <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting && <Spinner />}
        {t('sendCode')}
      </Button>
    </form>
  );
}

function VerifyStep({
  mode,
  identifier,
  onChangeIdentifier,
  onError,
}: {
  mode: Mode;
  identifier: string;
  onChangeIdentifier: () => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations('tenant.login.form');
  const form = useForm<VerifyForm>({
    resolver: zodResolver(verifyOtpSchema),
    defaultValues: { identifier, code: '' },
  });

  return (
    <form
      className="space-y-4"
      onSubmit={form.handleSubmit(async (values) => {
        try {
          if (mode === 'email') {
            await api.post('/v1/auth/sign-in/email-otp', {
              email: values.identifier,
              otp: values.code,
            });
          } else {
            await api.post('/v1/auth/phone-number/verify', {
              phoneNumber: values.identifier,
              code: values.code,
            });
          }
          window.location.assign(POST_LOGIN_PATH);
        } catch (err) {
          onError(err instanceof ApiError ? err.problem.title : t('invalidCode'));
        }
      })}
    >
      <p className="text-sm text-muted-foreground">
        {t.rich('codeSentTo', {
          identifier,
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

function PasswordStep({ onError }: { onError: (msg: string) => void }) {
  const t = useTranslations('tenant.login.passwordForm');
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
          onError(t('invalidCredentials'));
        }
      })}
    >
      <FormField
        label={t('phoneLabel')}
        htmlFor="phoneNumber"
        error={form.formState.errors.phoneNumber}
        description={t('phoneDescription')}
      >
        <Input
          id="phoneNumber"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          placeholder="+84..."
          {...form.register('phoneNumber')}
        />
      </FormField>
      <FormField
        label={t('passwordLabel')}
        htmlFor="password"
        error={form.formState.errors.password}
      >
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          {...form.register('password')}
        />
      </FormField>
      <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting && <Spinner />}
        {t('signIn')}
      </Button>
    </form>
  );
}
