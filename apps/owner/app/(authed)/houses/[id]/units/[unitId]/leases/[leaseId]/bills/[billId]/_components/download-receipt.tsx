import { Button } from '@repo/ui';

import { API_URL } from '../../../../../../../../../../../lib/app-config';

/**
 * Receipt download anchor. The PDF endpoint lives on the API (different
 * origin in dev). For navigation requests browsers send the session cookie
 * for the API origin automatically; the `download` attribute is treated as
 * a hint cross-origin, but the server's `Content-Disposition: attachment`
 * forces save anyway.
 */
export function DownloadReceipt({
  houseId,
  unitId,
  leaseId,
  billId,
}: {
  houseId: string;
  unitId: string;
  leaseId: string;
  billId: string;
}) {
  const href = `${API_URL}/v1/houses/${houseId}/units/${unitId}/leases/${leaseId}/bills/${billId}/receipt.pdf`;
  return (
    <Button asChild variant="outline">
      <a href={href} download={`bill-${billId}.pdf`} rel="noopener">
        Download receipt (PDF)
      </a>
    </Button>
  );
}
