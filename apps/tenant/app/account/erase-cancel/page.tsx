import { getTranslations } from 'next-intl/server';

import { ApiError } from '../../../lib/api';
import { serverApi } from '../../../lib/session';

export async function generateMetadata() {
  const t = await getTranslations('tenant.eraseCancel');
  return { title: t('metadataTitle') };
}

interface SearchParams {
  token?: string;
}

/**
 * Phase 10.6 — public landing page for the email "undo" link.
 * Runs as a server component so we hit the API on first load and
 * surface the outcome without needing client-side state.
 *
 * The cancel endpoint is unauthenticated; the token in the URL is
 * the credential.
 */
export default async function EraseCancelPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const t = await getTranslations('tenant.eraseCancel');
  const { token } = await searchParams;
  if (!token) {
    return (
      <Shell title={t('noToken')}>
        <p>{t('noTokenBody')}</p>
      </Shell>
    );
  }

  let ok = false;
  let message = '';
  try {
    await serverApi('/v1/account/erase-cancel', { method: 'POST', body: { token } });
    ok = true;
  } catch (err) {
    if (err instanceof ApiError) {
      message = err.problem.title;
    } else {
      message = t('fallback');
    }
  }

  if (ok) {
    return (
      <Shell title={t('ok')}>
        <p>{t('okBody')}</p>
      </Shell>
    );
  }

  return (
    <Shell title={t('fail')}>
      <p>{message}</p>
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-md space-y-4 px-6 py-12">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <div className="text-sm text-muted-foreground">{children}</div>
    </main>
  );
}
