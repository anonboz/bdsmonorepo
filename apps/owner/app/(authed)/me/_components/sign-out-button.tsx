'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@repo/ui';

import { api } from '../../../../lib/api';

/**
 * Ends the better-auth session and returns the user to /login. Best-effort:
 * even if the sign-out call fails, we leave the authed area so the client
 * stops using the session.
 */
export function SignOutButton() {
  const t = useTranslations('owner.chrome');
  const [busy, setBusy] = useState(false);

  return (
    <Button
      variant="outline"
      className="w-full"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api.post('/v1/auth/sign-out');
        } catch {
          // Drop the client session by leaving regardless.
        }
        window.location.assign('/login');
      }}
    >
      {t('signOut')}
    </Button>
  );
}
