import Link from 'next/link';

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

export const metadata = { title: 'Payment received' };

export default async function PaymentSuccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ billId: string }>;
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { billId } = await params;
  const { session_id } = await searchParams;

  return (
    <main className="mx-auto max-w-xl space-y-6 px-6 py-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Thanks for your payment</CardTitle>
          <CardDescription>
            Stripe has confirmed the charge. Your bill will flip to <strong>PAID</strong> shortly
            after our system receives the webhook — usually a few seconds.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          {session_id && (
            <p>
              <span className="font-medium text-foreground">Stripe reference:</span>{' '}
              <code className="text-xs">{session_id}</code>
            </p>
          )}
          <p>
            If the bill is still shown as outstanding more than a minute from now, refresh the page
            or contact your landlord.
          </p>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button asChild>
          <Link href={`/my-bills/${billId}`}>Back to bill</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/my-bills">All bills</Link>
        </Button>
      </div>
    </main>
  );
}
