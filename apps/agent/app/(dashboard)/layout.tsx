import { ClipboardList, FileText, Home, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession, type SessionContext } from "@/lib/session";
import { MobileNav } from "@repo/ui";

const NAV = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/applications", label: "Applications", icon: ClipboardList },
  { href: "/screening", label: "Screening", icon: ShieldCheck },
  { href: "/leases", label: "Leases", icon: FileText },
] as const;

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  let session: SessionContext;
  try {
    session = await getSession();
  } catch {
    redirect("/login");
  }

  const footer = (
    <>
      <p className="font-medium text-foreground">{session.name}</p>
      <p className="capitalize">{session.role}</p>
    </>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <MobileNav
        items={NAV}
        brand={
          <>
            <ClipboardList className="h-5 w-5 text-primary" />
            Agent
          </>
        }
        footer={footer}
      />

      <aside className="hidden flex-col border-r bg-sidebar text-sidebar-foreground lg:flex">
        <div className="flex h-14 items-center gap-2 px-5 font-semibold">
          <ClipboardList className="h-5 w-5 text-primary" />
          Agent
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
        <div className="border-t px-5 py-3 text-xs text-muted-foreground">{footer}</div>
      </aside>
      <main className="min-w-0">{children}</main>
    </div>
  );
}
