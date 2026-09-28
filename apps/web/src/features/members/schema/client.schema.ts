import { z } from 'zod';
import { ORG_ROLES } from '@novabase/constants';
import type { InviteMemberInput, UpdateRoleInput } from '@novabase/types';

export const inviteSchema = z.object({
  email: z.email('Invalid email'),
}) satisfies z.ZodType<InviteMemberInput>;

export const updateRoleSchema = z.object({
  role: z.enum([ORG_ROLES.ADMIN, ORG_ROLES.DEVELOPER]),
}) satisfies z.ZodType<UpdateRoleInput>;
