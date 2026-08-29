import { getSession, requireAdmin } from "@/lib/session";
import { listSystemAnnouncements } from "@/services/announcement.service";

import { AnnouncementsManager } from "./announcements-manager";

export const dynamic = "force-dynamic";

export default async function AnnouncementsPage() {
  const session = await getSession();
  requireAdmin(session);
  const rows = await listSystemAnnouncements(session);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">System announcements</h1>
        <p className="text-muted-foreground">
          Platform-wide notices shown to every tenant on their home page. Published announcements
          are visible immediately; drafts stay hidden until you publish them.
        </p>
      </header>

      <AnnouncementsManager initialRows={rows} />
    </div>
  );
}
