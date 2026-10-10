'use client';

import { useMemo, useState } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ProjectAuthUser } from '@novabase/types';
import { Mail } from 'lucide-react';

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

function ProviderIcon({ provider }: { provider: ProjectAuthUser['provider'] }) {
  if (provider === 'github') return <GithubIcon className="size-4" />;
  if (provider === 'google') {
    return <span className="text-xs font-semibold text-blue-600">G</span>;
  }
  return <Mail className="size-4" />;
}

function providerType(provider: ProjectAuthUser['provider']) {
  return provider === 'email' ? 'Email' : 'Social';
}

export function ProjectAuthUsers({ users }: { users: ProjectAuthUser[] }) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.email.toLowerCase().includes(q) || u.id.toLowerCase().includes(q),
    );
  }, [query, users]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-medium">Users</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          End-users who signed up to apps built on this project.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search email, user ID"
          className="max-w-sm"
        />
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead>UID</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Providers</TableHead>
              <TableHead>Provider type</TableHead>
              <TableHead>Created at</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-10 text-center text-muted-foreground"
                >
                  {users.length === 0
                    ? 'No users yet. Sign up from the SDK demo to populate this table.'
                    : 'No users match your search.'}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <Avatar className="size-8">
                      <AvatarFallback className="text-xs">
                        {user.email.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  </TableCell>
                  <TableCell className="max-w-[140px] truncate font-mono text-xs text-muted-foreground">
                    {user.id}
                  </TableCell>
                  <TableCell className="font-medium">{user.email}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <ProviderIcon provider={user.provider} />
                      <span className="capitalize">{user.provider}</span>
                      {user.emailVerified && (
                        <Badge variant="secondary" className="text-xs">
                          verified
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{providerType(user.provider)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(user.createdAt).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-sm text-muted-foreground">
        Total: {filtered.length} user{filtered.length === 1 ? '' : 's'}
      </p>
    </div>
  );
}
