'use client';

import { useTranslations } from 'next-intl';

import { LocaleSwitcher, type Locale } from '@repo/i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui';

import { api } from '../../../../lib/api';

/**
 * Phase 11.4 — language preference card on the owner /me page. Wires
 * `@repo/i18n`'s LocaleSwitcher to `PATCH /v1/me` so the change
 * persists server-side (`User.locale`) in addition to the local
 * cookie.
 */
export function LanguageCard({ current }: { current: Locale }) {
  const t = useTranslations('owner.me.language');
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <LocaleSwitcher
          current={current}
          onSave={async (locale) => {
            await api.patch('/v1/me', { locale });
          }}
        />
      </CardContent>
    </Card>
  );
}
