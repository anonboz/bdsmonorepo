import { getSession, requireAdmin } from "@/lib/session";
import { listUtilityBounds } from "@/services/utility-bound.service";
import { Card, CardContent } from "@repo/ui";

import { UtilityBoundsForm } from "./utility-bounds-form";

export const dynamic = "force-dynamic";

export default async function UtilityBoundsPage() {
  const session = await getSession();
  requireAdmin(session);
  const rows = await listUtilityBounds(session);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Utility rate bounds</h1>
        <p className="text-muted-foreground">
          Platform-wide minimum and maximum price per consumption unit. Owners must set their
          per-organization utility rates within these bounds.
        </p>
      </header>

      <Card>
        <CardContent className="p-0">
          <UtilityBoundsForm rows={rows} />
        </CardContent>
      </Card>
    </div>
  );
}
