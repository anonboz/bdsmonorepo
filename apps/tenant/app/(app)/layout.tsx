import { Bell, FileText, Home, Receipt, Wrench } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LocaleSwitcher } from "@/i18n/locale-switcher";
import { getTranslations } from "@/i18n/server";
import { getSession, type SessionContext } from "@/lib/session";
import { getUnreadCount } from "@/services/notification.service";
import { MobileNav } from "@repo/ui";
import { NotificationBell } from "./_components/notification-bell";
import { SignOutButton } from "./_components/sign-out-button";

const NAV = [
  { href: "/", key: "home", icon: Home },
  { href: "/my-leases", key: "leases", icon: FileText },
  { href: "/my-bills", key: "bills", icon: Receipt },
  { href: "/my-tickets", key: "requests", icon: Wrench },
  { href: "/notifications", key: "notifications", icon: Bell },
] as const;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let session: SessionContext;
  try {
    session = await getSession();
  } catch {
    redirect("/login");
  }

  const [t, unread] = await Promise.all([getTranslations(), getUnreadCount(session)]);

  const mobileNavItems = NAV.map(({ href, key, icon: Icon }) => ({
    href,
    icon: <Icon className="h-4 w-4 shrink-0" />,
    label: t(`nav.${key}`),
  }));

  const footer = (
    <div className="space-y-3">
      <LocaleSwitcher className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60" />
      <div className="text-xs text-muted-foreground">
        <p className="font-medium text-foreground">{session.name}</p>
        <p>{t("role")}</p>
      </div>
      <SignOutButton />
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <MobileNav
        items={mobileNavItems}
        brand={
          <>
            <Home className="h-5 w-5 text-primary" />
            {t("brand")}
          </>
        }
        footer={footer}
        actions={<NotificationBell initialUnread={unread} />}
      />

      <aside className="hidden flex-col border-r bg-sidebar text-sidebar-foreground lg:flex">
        <div className="flex h-14 items-center gap-2 px-5 font-semibold">
          <Home className="h-5 w-5 text-primary" />
          {t("brand")}
          <NotificationBell initialUnread={unread} className="ml-auto" />
        </div>
        <nav className="flex-1 space-y-1 px-3 py-2">
          {NAV.map(({ href, key, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <Icon className="h-4 w-4 shrink-0" />
              {t(`nav.${key}`)}
            </Link>
          ))}
        </nav>
        <div className="border-t px-5 py-3">{footer}</div>
      </aside>
      <main className="min-w-0">{children}</main>
    </div>
  );
}
