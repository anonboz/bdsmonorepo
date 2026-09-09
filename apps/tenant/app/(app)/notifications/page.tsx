import { getTranslations } from "@/i18n/server";
import { getSession } from "@/lib/session";
import { listMyNotifications } from "@/services/notification.service";
import { NotificationList, type NotificationListRow } from "./notification-list";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const session = await getSession();
  const { rows, unreadCount } = await listMyNotifications(session);
  const t = await getTranslations("notifications");

  // Dates → ISO strings so the rows can cross into the client list component.
  const serialized: NotificationListRow[] = rows.map((n) => ({
    ...n,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </header>

      <NotificationList rows={serialized} unreadCount={unreadCount} />
    </div>
  );
}
