"use client";

// Mobile nav drawer shared by every dashboard shell (landlord, tenant, agent,
// admin, vendor). Built on the native <dialog> element via showModal(): free
// focus trap, ESC-to-close, and a real ::backdrop — no extra dependency.
// Pair with a desktop <aside> that's hidden below `lg` (this component is the
// `lg:hidden` counterpart), so the two never render at the same time.

import { Menu, X } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import * as React from "react";

import { cn } from "../lib/cn";

export interface MobileNavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export interface MobileNavProps {
  /** Nav links, same shape each app's own NAV array already uses. */
  items: readonly MobileNavItem[];
  /** Rendered in both the collapsed top bar and the open drawer header. */
  brand: React.ReactNode;
  /** Current pathname, for aria-current="page" styling. */
  activeHref?: string;
  /** User name/role/sign-out slot, rendered at the bottom of the drawer. */
  footer?: React.ReactNode;
  className?: string;
}

export function MobileNav({ items, brand, activeHref, footer, className }: MobileNavProps) {
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const [isOpen, setIsOpen] = React.useState(false);

  // Belt-and-suspenders scroll lock — showModal() makes the rest of the page
  // inert in evergreen browsers, but background scroll behind an open
  // <dialog> isn't consistently blocked everywhere, so lock it explicitly.
  React.useEffect(() => {
    if (!isOpen) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [isOpen]);

  const open = () => {
    dialogRef.current?.showModal();
    setIsOpen(true);
  };
  const close = () => dialogRef.current?.close();

  return (
    <>
      {/* Collapsed top bar — replaces the desktop <aside> below `lg`. */}
      <div className="flex h-14 items-center justify-between border-b bg-sidebar px-4 text-sidebar-foreground lg:hidden">
        <div className="flex items-center gap-2 font-semibold">{brand}</div>
        <button
          type="button"
          onClick={open}
          aria-label="Open menu"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      <dialog
        ref={dialogRef}
        aria-label="Main navigation"
        // Native "close" fires on ESC, our own close(), or backdrop click —
        // one handler keeps isOpen (and the scroll lock) in sync regardless
        // of what triggered it.
        onClose={() => setIsOpen(false)}
        onClick={(e) => {
          if (e.target === dialogRef.current) close();
        }}
        className={cn(
          "fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-72 max-w-[85vw] border-0 border-r bg-sidebar p-0 text-sidebar-foreground shadow-lg outline-none backdrop:bg-foreground/50",
          "open:flex open:flex-col",
          className,
        )}
      >
        <div className="flex h-14 shrink-0 items-center justify-between px-5">
          <div className="flex items-center gap-2 font-semibold">{brand}</div>
          <button
            type="button"
            onClick={close}
            aria-label="Close menu"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav aria-label="Main" className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {items.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              // Shared across apps with different route tables, so typedRoutes
              // can't verify this structurally — each app supplies real
              // literal hrefs via its own NAV array.
              href={href as Route}
              onClick={close}
              aria-current={activeHref === href ? "page" : undefined}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-accent-foreground"
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          ))}
        </nav>

        {footer ? (
          <div className="shrink-0 border-t px-5 py-3 text-xs text-muted-foreground">{footer}</div>
        ) : null}
      </dialog>
    </>
  );
}
