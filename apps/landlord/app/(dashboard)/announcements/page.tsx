import { getSession } from "@/lib/session";
import { listOrgAnnouncements } from "@/services/announcement.service";

import { AnnouncementsManager } from "./announcements-manager";

export const dynamic = "force-dynamic";

export default async function AnnouncementsPage() {
  const session = await getSession();
  const rows = await listOrgAnnouncements(session);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Announcements</h1>
        <p className="text-muted-foreground">
          Notices shown to your tenants on their home page. Published announcements are visible
          immediately; drafts stay hidden until you publish them.
        </p>
      </header>

      <AnnouncementsManager initialRows={rows} />
    </div>
  );
}
