import { z } from 'zod';
import type { CreateProjectInput } from '@novabase/types';

export const createProjectSchema = z.object({
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(20, 'Name must be at most 20 characters'),
}) satisfies z.ZodType<CreateProjectInput>;
