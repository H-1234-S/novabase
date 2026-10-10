'use client';

import { useState, useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ProjectOAuthSettings } from '@novabase/types';
import { ChevronRight, Mail } from 'lucide-react';
import { cn } from '@/lib/utils';

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

type ProviderId = 'email' | 'google' | 'github';

const providers: Array<{
  id: ProviderId;
  name: string;
  icon: React.ReactNode;
}> = [
  { id: 'email', name: 'Email', icon: <Mail className="size-5" /> },
  {
    id: 'google',
    name: 'Google',
    icon: <span className="text-base font-semibold text-blue-600">G</span>,
  },
  { id: 'github', name: 'GitHub', icon: <GithubIcon className="size-5" /> },
];

function isProviderEnabled(
  id: ProviderId,
  settings: ProjectOAuthSettings,
): boolean {
  if (id === 'email') return true;
  if (id === 'google') return Boolean(settings.googleClientId);
  return Boolean(settings.githubClientId);
}

export function ProjectAuthProviders({
  orgSlug,
  projectSlug,
  initialSettings,
}: {
  orgSlug: string;
  projectSlug: string;
  initialSettings: ProjectOAuthSettings;
}) {
  const [isPending, startTransition] = useTransition();
  const [settings, setSettings] =
    useState<ProjectOAuthSettings>(initialSettings);
  const [selected, setSelected] = useState<ProviderId | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function save() {
    setMessage(null);
    startTransition(async () => {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/orgs/${orgSlug}/projects/${projectSlug}/auth/settings`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(settings),
        },
      );

      if (!res.ok) {
        setMessage('Save failed');
        return;
      }

      setMessage('Saved');
    });
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-medium">Sign In / Providers</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure authentication providers for this project.
        </p>
      </div>

      <div className="rounded-lg border divide-y">
        {providers.map((provider) => {
          const enabled = isProviderEnabled(provider.id, settings);
          const isOpen = selected === provider.id;

          return (
            <div key={provider.id}>
              <button
                type="button"
                onClick={() => setSelected(isOpen ? null : provider.id)}
                className="flex w-full items-center gap-4 px-4 py-4 text-left hover:bg-muted/40"
              >
                <div className="flex size-9 items-center justify-center rounded-md border bg-background">
                  {provider.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{provider.name}</p>
                </div>
                <Badge
                  variant={enabled ? 'default' : 'secondary'}
                  className={cn(
                    enabled && 'bg-emerald-600 text-white hover:bg-emerald-600',
                  )}
                >
                  {enabled ? 'Enabled' : 'Disabled'}
                </Badge>
                <ChevronRight
                  className={cn(
                    'size-4 text-muted-foreground transition-transform',
                    isOpen && 'rotate-90',
                  )}
                />
              </button>

              {isOpen && provider.id === 'email' && (
                <div className="border-t bg-muted/20 px-4 py-4 text-sm text-muted-foreground">
                  Email + password and magic link are always enabled for this
                  project. No extra configuration needed.
                </div>
              )}

              {isOpen && provider.id === 'google' && (
                <div className="space-y-4 border-t bg-muted/20 px-4 py-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="googleClientId">Client ID</Label>
                      <Input
                        id="googleClientId"
                        value={settings.googleClientId ?? ''}
                        onChange={(e) =>
                          setSettings((s) => ({
                            ...s,
                            googleClientId: e.target.value,
                          }))
                        }
                        placeholder="Google OAuth client ID"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="googleClientSecret">Client Secret</Label>
                      <Input
                        id="googleClientSecret"
                        type="password"
                        value={settings.googleClientSecret ?? ''}
                        onChange={(e) =>
                          setSettings((s) => ({
                            ...s,
                            googleClientSecret: e.target.value,
                          }))
                        }
                        placeholder="Google OAuth client secret"
                      />
                    </div>
                  </div>
                  <Button type="button" onClick={save} disabled={isPending}>
                    {isPending ? 'Saving…' : 'Save Google settings'}
                  </Button>
                </div>
              )}

              {isOpen && provider.id === 'github' && (
                <div className="space-y-4 border-t bg-muted/20 px-4 py-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="githubClientId">Client ID</Label>
                      <Input
                        id="githubClientId"
                        value={settings.githubClientId ?? ''}
                        onChange={(e) =>
                          setSettings((s) => ({
                            ...s,
                            githubClientId: e.target.value,
                          }))
                        }
                        placeholder="GitHub OAuth client ID"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="githubClientSecret">Client Secret</Label>
                      <Input
                        id="githubClientSecret"
                        type="password"
                        value={settings.githubClientSecret ?? ''}
                        onChange={(e) =>
                          setSettings((s) => ({
                            ...s,
                            githubClientSecret: e.target.value,
                          }))
                        }
                        placeholder="GitHub OAuth client secret"
                      />
                    </div>
                  </div>
                  <Button type="button" onClick={save} disabled={isPending}>
                    {isPending ? 'Saving…' : 'Save GitHub settings'}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {message && <p className="text-sm">{message}</p>}
    </div>
  );
}
