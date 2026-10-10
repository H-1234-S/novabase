'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const manageItems = [{ label: 'Users', segment: 'users' }] as const;

const configItems = [
  { label: 'Sign In / Providers', segment: 'providers' },
  { label: 'URL Configuration', segment: 'url-configuration' },
] as const;

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'block shrink-0 whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors',
        active
          ? 'bg-muted font-medium text-foreground'
          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
      )}
    >
      {children}
    </Link>
  );
}

export function ProjectAuthShell({
  orgSlug,
  projectSlug,
  children,
}: {
  orgSlug: string;
  projectSlug: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const base = `/organizations/${orgSlug}/${projectSlug}/auth`;

  function isActive(segment: string) {
    return (
      pathname === `${base}/${segment}` ||
      pathname.startsWith(`${base}/${segment}/`)
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col md:flex-row">
      <aside className="flex w-full shrink-0 flex-col border-b bg-background md:w-56 md:border-b-0 md:border-r">
        <div className="border-b px-4 py-3 md:py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Authentication
          </p>
        </div>

        <nav className="flex gap-1 overflow-x-auto p-2 md:flex-col md:gap-0 md:space-y-6 md:overflow-visible md:p-3">
          <div className="flex shrink-0 gap-1 md:block md:space-y-1">
            <p className="hidden px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground md:block">
              Manage
            </p>
            <div className="flex gap-1 md:block md:space-y-1">
              {manageItems.map(({ label, segment }) => (
                <NavLink
                  key={segment}
                  href={`${base}/${segment}`}
                  active={isActive(segment)}
                >
                  {label}
                </NavLink>
              ))}
            </div>
          </div>

          <div className="flex shrink-0 gap-1 md:block md:space-y-1">
            <p className="hidden px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground md:block">
              Configuration
            </p>
            <div className="flex gap-1 md:block md:space-y-1">
              {configItems.map(({ label, segment }) => (
                <NavLink
                  key={segment}
                  href={`${base}/${segment}`}
                  active={isActive(segment)}
                >
                  {label}
                </NavLink>
              ))}
            </div>
          </div>
        </nav>
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
