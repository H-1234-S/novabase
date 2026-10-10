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
import { organizationAction } from './action';
import { createOrgSchema } from './client.schema';
import { ORGANIZATION_INTENT } from './constants';

type CreateOrgValues = z.infer<typeof createOrgSchema>;

export function CreateOrgForm() {
  const [state, formAction, isPending] = useActionState(organizationAction, {});
  const form = useForm<CreateOrgValues>({
    resolver: zodResolver(createOrgSchema),
    defaultValues: { name: '' },
  });

  return (
    <form
      action={formAction}
      noValidate
      onSubmitCapture={async (e) => {
        const ok = await form.trigger(undefined, { shouldFocus: true });
        if (!ok) e.preventDefault();
      }}
      className="max-w-md space-y-4"
    >
      <input type="hidden" name="intent" value={ORGANIZATION_INTENT.CREATE} />

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      <FieldGroup>
        <Controller
          name="name"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="name">Organization name</FieldLabel>
              <Input
                id="name"
                placeholder="My Company"
                {...field}
                name="name"
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
      </FieldGroup>

      <Button type="submit" disabled={isPending}>
        {isPending ? 'Creating…' : 'Create organization'}
      </Button>
    </form>
  );
}
