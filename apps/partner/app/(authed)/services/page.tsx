import Link from 'next/link';

import type { Page, Service } from '@repo/shared';
import { Button, Card, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { ApiError } from '../../../lib/api';
import { formatMoney } from '../../../lib/format';
import { serverApi } from '../../../lib/session';

export const metadata = { title: 'Services' };

export default async function ServicesPage() {
  const page = await fetchServices();

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href="/">← Back</Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Services</h1>
            <p className="text-sm text-muted-foreground">
              {page === null
                ? 'Publish a profile first to start listing services.'
                : page.items.length === 0
                  ? 'No services yet.'
                  : `${page.items.length} listed.`}
            </p>
          </div>
          {page !== null && (
            <Button asChild>
              <Link href="/services/new">New service</Link>
            </Button>
          )}
        </div>
      </div>

      {page === null ? (
        <Card>
          <CardHeader>
            <CardTitle>Profile required</CardTitle>
            <CardDescription>
              <Link href="/profile" className="underline">
                Publish your partner profile
              </Link>{' '}
              before adding services.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : page.items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Nothing here yet</CardTitle>
            <CardDescription>Add a service and set a base price.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="space-y-3">
          {page.items.map((s) => (
            <ServiceRow key={s.id} service={s} />
          ))}
        </ul>
      )}
    </main>
  );
}

function ServiceRow({ service }: { service: Service }) {
  return (
    <li>
      <Link
        href={`/services/${service.id}`}
        className="block rounded-lg border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:border-foreground/20"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <p className="font-semibold">{service.name}</p>
            <p className="text-xs text-muted-foreground">
              {formatMoney(service.basePrice, service.currency)} ·{' '}
              {service.isActive ? 'active' : 'inactive'}
            </p>
          </div>
        </div>
        {service.description && (
          <p className="mt-2 line-clamp-2 text-sm leading-relaxed">{service.description}</p>
        )}
      </Link>
    </li>
  );
}

async function fetchServices(): Promise<Page<Service> | null> {
  try {
    return await serverApi<Page<Service>>('/v1/me/services');
  } catch (err) {
    // The service returns 422 partners.profile_not_found when the partner
    // hasn't published a profile yet — show the empty-state instead.
    if (err instanceof ApiError && err.status === 422) return null;
    throw err;
  }
}
