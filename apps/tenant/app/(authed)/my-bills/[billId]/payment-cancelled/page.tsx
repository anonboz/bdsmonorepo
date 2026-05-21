import Link from 'next/link';

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

export const metadata = { title: 'Payment cancelled' };

export default async function PaymentCancelledPage({
  params,
}: {
  params: Promise<{ billId: string }>;
}) {
  const { billId } = await params;

  return (
    <main className="mx-auto max-w-xl space-y-6 px-6 py-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">No charge was made</CardTitle>
          <CardDescription>
            You cancelled the Stripe checkout before completing payment. Your bill is unchanged.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          You can try again whenever you&apos;re ready. We only charge after Stripe confirms the
          payment.
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button asChild>
          <Link href={`/my-bills/${billId}`}>Back to bill</Link>
        </Button>
      </div>
    </main>
  );
}
