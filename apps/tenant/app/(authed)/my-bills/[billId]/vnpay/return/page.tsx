import Link from 'next/link';

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

export const metadata = { title: 'VNPay return' };

/**
 * Browser landing page after VNPay's hosted checkout. VNPay also
 * fires a server-to-server IPN against `/v1/webhooks/vnpay/ipn` —
 * that's the only place we mutate DB state. This page is cosmetic:
 * it tells the tenant what the provider's `vnp_ResponseCode` was
 * and links back to the bill so they can see the updated state
 * once the IPN lands (usually within seconds).
 */
export default async function VnpayReturnPage({
  params,
  searchParams,
}: {
  params: Promise<{ billId: string }>;
  searchParams: Promise<{
    vnp_ResponseCode?: string;
    vnp_TxnRef?: string;
    vnp_TransactionNo?: string;
  }>;
}) {
  const { billId } = await params;
  const sp = await searchParams;
  const success = sp.vnp_ResponseCode === '00';

  return (
    <main className="mx-auto max-w-xl space-y-6 px-6 py-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">
            {success ? 'Thanks for your payment' : 'Payment did not complete'}
          </CardTitle>
          <CardDescription>
            {success
              ? 'VNPay confirmed the charge. Your bill flips to PAID once our server receives VNPay’s IPN — usually within seconds.'
              : `VNPay returned code ${sp.vnp_ResponseCode ?? 'unknown'}. No money was taken; try again whenever you’re ready.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          {sp.vnp_TransactionNo && (
            <p>
              <span className="font-medium text-foreground">VNPay reference:</span>{' '}
              <code className="text-xs">{sp.vnp_TransactionNo}</code>
            </p>
          )}
          {sp.vnp_TxnRef && (
            <p>
              <span className="font-medium text-foreground">Our reference:</span>{' '}
              <code className="text-xs">{sp.vnp_TxnRef}</code>
            </p>
          )}
          {success && (
            <p>
              If the bill is still shown as outstanding more than a minute from now, refresh the
              page or contact your landlord.
            </p>
          )}
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
