import { z } from 'zod';
import { PROJECT_AUTH_INTENT } from '../data/project-auth-constants';
import {
  githubOAuthSchema,
  googleOAuthSchema,
  siteUrlSchema,
} from './project-auth-client.schema';

export const projectAuthServerSchema = z.discriminatedUnion('intent', [
  z.object({
    intent: z.literal(PROJECT_AUTH_INTENT.SAVE_GOOGLE),
    ...googleOAuthSchema.shape,
  }),
  z.object({
    intent: z.literal(PROJECT_AUTH_INTENT.SAVE_GITHUB),
    ...githubOAuthSchema.shape,
  }),
  z.object({
    intent: z.literal(PROJECT_AUTH_INTENT.SAVE_SITE_URL),
    ...siteUrlSchema.shape,
  }),
]);
