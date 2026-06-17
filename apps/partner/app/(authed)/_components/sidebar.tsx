'use client';

import {
  Banknote,
  Bell,
  Briefcase,
  Home,
  LogOut,
  type LucideIcon,
  Menu,
  Settings,
  Wrench,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button, cn } from '@repo/ui';

import { api } from '../../../lib/api';
import { APP_NAME } from '../../../lib/app-config';

interface NavItem {
  href: string;
  key: string;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { href: '/', key: 'home', icon: Home },
  { href: '/jobs', key: 'jobs', icon: Briefcase },
  { href: '/services', key: 'services', icon: Wrench },
  { href: '/payouts', key: 'payouts', icon: Banknote },
  { href: '/notifications', key: 'notifications', icon: Bell },
  { href: '/profile', key: 'profile', icon: Settings },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Persistent partner navigation. Slide-in drawer with a top bar on mobile
 * (partner is mobile-first per apps/partner/CLAUDE.md); a fixed left rail on
 * >=1024px. Wraps all `(authed)` routes via the layout. Labels come from
 * `@repo/i18n`.
 */
export function Sidebar({ userName }: { userName: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const t = useTranslations('partner.nav');
  const tChrome = useTranslations('partner.chrome');

  async function signOut() {
    try {
      await api.post('/v1/auth/sign-out');
    } catch {
      /* even if the call fails, drop the client session by leaving */
    }
    window.location.assign('/login');
  }

  return (
    <>
      {/* Mobile top bar */}
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-3 border-b bg-background px-4 lg:hidden">
        <Button
          variant="outline"
          size="icon"
          aria-label="Open menu"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <Menu className="h-5 w-5" />
        </Button>
        <Link href="/" className="font-semibold">
          {APP_NAME}
        </Link>
      </header>

      {/* Mobile drawer backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          aria-hidden
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar — drawer on mobile, fixed rail on lg */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r bg-background transition-transform lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-14 items-center justify-between px-4">
          <Link href="/" className="text-lg font-semibold" onClick={() => setOpen(false)}>
            {APP_NAME}
          </Link>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close menu"
            className="lg:hidden"
            onClick={() => setOpen(false)}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                onClick={() => setOpen(false)}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {t(item.key)}
              </Link>
            );
          })}
        </nav>

        <div className="border-t p-3">
          <p className="truncate px-3 pb-2 text-xs text-muted-foreground" title={userName}>
            {tChrome.rich('signedInAs', {
              name: userName,
              strong: (chunks) => <strong className="font-medium text-foreground">{chunks}</strong>,
            })}
          </p>
          <Button variant="outline" className="w-full justify-start gap-3" onClick={signOut}>
            <LogOut className="h-4 w-4" />
            {tChrome('signOut')}
          </Button>
        </div>
      </aside>
    </>
  );
}
