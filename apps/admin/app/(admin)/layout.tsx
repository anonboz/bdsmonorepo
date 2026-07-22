import { Building2, Gauge, LayoutDashboard, Settings, Users } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession, type SessionContext } from "@/lib/session";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/organizations", label: "Organizations", icon: Building2 },
  { href: "/users", label: "Users", icon: Users },
  { href: "/utility-bounds", label: "Utility bounds", icon: Gauge },
  { href: "/config", label: "Config", icon: Settings },
] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  let session: SessionContext;
  try {
    session = await getSession();
  } catch {
    redirect("/login");
  }

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="flex flex-col border-r bg-sidebar text-sidebar-foreground">
        <div className="flex h-14 items-center gap-2 px-5 font-semibold">
          <Building2 className="h-5 w-5 text-primary" />
          Admin — Platform
        </div>
        <nav className="flex-1 space-y-1 px-3 py-2">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="border-t px-5 py-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">{session.name}</p>
          <p>platform admin</p>
        </div>
      </aside>
      <main className="min-w-0">{children}</main>
    </div>
  );
}
