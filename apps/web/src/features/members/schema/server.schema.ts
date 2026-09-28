import { z } from 'zod';
import { MEMBERS_INTENT } from '../data/constants';
import { inviteSchema, updateRoleSchema } from './client.schema';

export const membersServerSchema = z.discriminatedUnion('intent', [
  z.object({
    intent: z.literal(MEMBERS_INTENT.INVITE),
    ...inviteSchema.shape,
  }),
  z.object({
    intent: z.literal(MEMBERS_INTENT.UPDATE_ROLE),
    memberId: z.string(),
    ...updateRoleSchema.shape,
  }),
  z.object({
    intent: z.literal(MEMBERS_INTENT.REMOVE),
    memberId: z.string(),
  }),
]);
