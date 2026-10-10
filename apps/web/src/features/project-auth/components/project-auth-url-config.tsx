'use client';

import { useActionState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { projectAuthAction } from '../project-auth-action';
import { siteUrlSchema } from '../schemas/project-auth-client.schema';
import { PROJECT_AUTH_INTENT } from '../data/project-auth-constants';

type SiteUrlValues = z.infer<typeof siteUrlSchema>;

function CopyRow({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
      <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/30 px-3 py-2 text-sm">
        {value}
      </code>
      <Button type="button" variant="ghost" size="sm" onClick={copy}>
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </Button>
    </div>
  );
}

export function ProjectAuthUrlConfig({
  orgSlug,
  projectSlug,
  initialSiteUrl,
  apiBaseUrl,
}: {
  orgSlug: string;
  projectSlug: string;
  initialSiteUrl: string;
  apiBaseUrl: string;
}) {
  const boundAction = projectAuthAction.bind(null, { orgSlug, projectSlug });
  const [state, formAction, isPending] = useActionState(boundAction, {});

  const form = useForm<SiteUrlValues>({
    resolver: zodResolver(siteUrlSchema),
    defaultValues: { siteUrl: initialSiteUrl },
  });

  const redirectUrls = [
    `${apiBaseUrl}/projects/${projectSlug}/auth/google/callback`,
    `${apiBaseUrl}/projects/${projectSlug}/auth/github/callback`,
    `${apiBaseUrl}/projects/${projectSlug}/auth/magic-link/verify`,
  ];

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-medium">URL Configuration</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure site URL and redirect URLs used by auth providers.
        </p>
      </div>

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-medium">Site URL</h2>
          <p className="text-sm text-muted-foreground">
            Where users land after OAuth sign-in (your app URL).
          </p>
        </div>

        <form
          action={formAction}
          noValidate
          onSubmitCapture={async (e) => {
            const ok = await form.trigger(undefined, { shouldFocus: true });
            if (!ok) e.preventDefault();
          }}
          className="max-w-xl space-y-4"
        >
          {state.error && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}
          {state.success && (
            <p className="text-sm text-emerald-600">{state.success}</p>
          )}

          <FieldGroup>
            <Controller
              name="siteUrl"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="siteUrl">Site URL</FieldLabel>
                  <Input
                    {...field}
                    id="siteUrl"
                    placeholder="http://localhost:3001"
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
          </FieldGroup>

          <Button
            type="submit"
            name="intent"
            value={PROJECT_AUTH_INTENT.SAVE_SITE_URL}
            disabled={isPending}
          >
            {isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </form>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-medium">Redirect URLs</h2>
          <p className="text-sm text-muted-foreground">
            Add these callback URLs in your Google and GitHub OAuth app
            settings.
          </p>
        </div>

        <div className="rounded-lg border divide-y">
          {redirectUrls.map((url) => (
            <CopyRow key={url} value={url} />
          ))}
        </div>
      </section>
    </div>
  );
}
