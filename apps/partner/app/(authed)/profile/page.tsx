import Link from 'next/link';

import type { PartnerProfile } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { ProfileForm } from './profile-form';
import { ApiError } from '../../../lib/api';
import { serverApi } from '../../../lib/session';

export const metadata = { title: 'Partner profile' };

export default async function PartnerProfilePage() {
  const profile = await fetchProfile();

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href="/">← Back</Link>
        </Button>
        <h1 className="text-2xl font-semibold">Partner profile</h1>
        <p className="text-sm text-muted-foreground">
          What owners see when they browse the partner directory. Publish it to start listing
          services.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Business</CardTitle>
          <CardDescription>
            {profile
              ? `Last updated ${new Date(profile.updatedAt).toLocaleDateString()}.`
              : 'No profile yet — fill in the form to publish one.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm initial={profile} />
        </CardContent>
      </Card>
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
