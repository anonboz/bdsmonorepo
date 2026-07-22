"use client";

// Clears the NextAuth session (the `tenant.session-token` cookie) and returns to
// /login. A client component because signOut() runs in the browser.

import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";

import { useTranslations } from "@/i18n/provider";

export function SignOutButton() {
  const t = useTranslations();

  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/login" })}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    >
      <LogOut className="h-4 w-4 shrink-0" />
      {t("signOut")}
    </button>
  );
}
