'use client';

import { useTranslations } from 'next-intl';

import { LocaleSwitcher, type Locale } from '@repo/i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui';

import { api } from '../../../../lib/api';

/**
 * Phase 11.3 — language preference card on the /me page. Wires the
 * `@repo/i18n` LocaleSwitcher to `PATCH /v1/me` so the change persists
 * server-side (`User.locale`) in addition to the local cookie. The
 * switcher reloads the page after `onSave` resolves so server-rendered
 * translations pick up the new locale on the next paint.
 */
export function LanguageCard({ current }: { current: Locale }) {
  const t = useTranslations('common.localeSwitcher');
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('label')}</CardTitle>
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
