'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@repo/ui';

import { API_URL } from '../../../../lib/app-config';

/**
 * Receipt download anchor. The PDF endpoint lives on the API (different
 * origin in dev). For navigation requests browsers send the session cookie
 * for the API origin automatically; the `download` attribute is treated as
 * a hint cross-origin, but the server's `Content-Disposition: attachment`
 * forces save anyway.
 */
export function DownloadReceipt({ billId }: { billId: string }) {
  const t = useTranslations('tenant.bills.detail');
  return (
    <Button asChild variant="outline">
      <a
        href={`${API_URL}/v1/me/bills/${billId}/receipt.pdf`}
        download={`bill-${billId}.pdf`}
        rel="noopener"
      >
        {t('receiptButton')}
      </a>
    </Button>
  );
}
