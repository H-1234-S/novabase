import { z } from 'zod';
import { PROJECTS_INTENT } from './constants';
import { createProjectSchema } from './client.schema';

export const projectsServerSchema = z.discriminatedUnion('intent', [
  z.object({
    intent: z.literal(PROJECTS_INTENT.CREATE),
    ...createProjectSchema.shape,
  }),
]);
