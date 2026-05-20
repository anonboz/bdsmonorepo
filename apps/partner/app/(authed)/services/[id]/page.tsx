import Link from 'next/link';
import { notFound } from 'next/navigation';

import type { Service } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { DeleteServiceButton } from './delete-service-button';
import { ApiError } from '../../../../lib/api';
import { formatMoney } from '../../../../lib/format';
import { serverApi } from '../../../../lib/session';

export default async function ServiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = await fetchService(id);
  if (!service) notFound();

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href="/services">← Back to services</Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{service.name}</h1>
            <p className="text-sm text-muted-foreground">
              {formatMoney(service.basePrice, service.currency)} ·{' '}
              {service.isActive ? 'active' : 'inactive'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href={`/services/${service.id}/edit`}>Edit</Link>
            </Button>
            <DeleteServiceButton serviceId={service.id} serviceName={service.name} />
          </div>
        </div>
      </div>

      {service.description && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Description</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{service.description}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Bookings</CardTitle>
          <CardDescription>Direct booking + ticket-routed jobs land in 5.2.</CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}

async function fetchService(id: string): Promise<Service | null> {
  try {
    return await serverApi<Service>(`/v1/me/services/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
