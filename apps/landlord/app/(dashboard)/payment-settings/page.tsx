import { getSession } from "@/lib/session";
import { getPaymentSettings } from "@/services/payment-settings.service";
import type { OrgRole } from "@repo/db";
import { Card, CardContent } from "@repo/ui";

import { PaymentSettingsForm } from "./payment-settings-form";

export const dynamic = "force-dynamic";

const EDIT_ROLES: readonly OrgRole[] = ["owner", "landlord"];

export default async function PaymentSettingsPage() {
  const session = await getSession();
  const settings = await getPaymentSettings(session);
  const canEdit = EDIT_ROLES.includes(session.role);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Payment settings</h1>
        <p className="text-muted-foreground">
          Choose how tenants can pay their bills. Bank details are shown on every open bill along
          with a VietQR code that fills in your account, the amount and a reference message.
        </p>
      </header>

      <Card>
        <CardContent className="pt-6">
          <PaymentSettingsForm initial={settings} canEdit={canEdit} />
        </CardContent>
      </Card>
    </div>
  );
}
