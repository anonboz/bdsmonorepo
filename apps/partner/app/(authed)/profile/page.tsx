import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { defaultLocale, type Locale } from '@repo/i18n';
import type { PartnerProfile } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { LanguageCard } from './language-card';
import { ProfileForm } from './profile-form';
import { SignOutButton } from './sign-out-button';
import { StripeConnectCard } from './stripe-connect-card';
import { ApiError } from '../../../lib/api';
import { getSession, serverApi } from '../../../lib/session';

export async function generateMetadata() {
  const t = await getTranslations('partner.profile');
  return { title: t('metadataTitle') };
}

export default async function PartnerProfilePage() {
  const [profile, session] = await Promise.all([fetchProfile(), getSession()]);
  const t = await getTranslations('partner.profile');
  const tChrome = await getTranslations('partner.chrome');
  const currentLocale: Locale = session?.user.locale ?? defaultLocale;

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href="/">{tChrome('back')}</Link>
        </Button>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('businessTitle')}</CardTitle>
          <CardDescription>
            {profile
              ? t('lastUpdated', { date: new Date(profile.updatedAt).toLocaleDateString() })
              : t('noProfile')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm initial={profile} />
        </CardContent>
      </Card>

      <LanguageCard current={currentLocale} />

      {profile && <StripeConnectCard profile={profile} />}

      <SignOutButton />
    </main>
  );
}

async function fetchProfile(): Promise<PartnerProfile | null> {
  try {
    return await serverApi<PartnerProfile>('/v1/me/partner-profile');
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
