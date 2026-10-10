import { z } from 'zod';

export const googleOAuthSchema = z.object({
  googleClientId: z.string().min(1, 'Client ID is required'),
  googleClientSecret: z.string().min(1, 'Client secret is required'),
});

export const githubOAuthSchema = z.object({
  githubClientId: z.string().min(1, 'Client ID is required'),
  githubClientSecret: z.string().min(1, 'Client secret is required'),
});

export const siteUrlSchema = z.object({
  siteUrl: z
    .string()
    .min(1, 'Site URL is required')
    .url('Must be a valid URL (include https://)'),
});
