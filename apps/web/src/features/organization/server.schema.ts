import { z } from 'zod';
import { ORGANIZATION_INTENT } from './constants';
import { createOrgSchema } from './client.schema';

export const organizationServerSchema = z.discriminatedUnion('intent', [
  z.object({
    intent: z.literal(ORGANIZATION_INTENT.CREATE),
    ...createOrgSchema.shape,
  }),
]);
