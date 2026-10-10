export const PROJECT_AUTH_INTENT = {
  SAVE_GOOGLE: 'SAVE_GOOGLE',
  SAVE_GITHUB: 'SAVE_GITHUB',
  SAVE_SITE_URL: 'SAVE_SITE_URL',
} as const;

export type ProjectAuthIntent =
  (typeof PROJECT_AUTH_INTENT)[keyof typeof PROJECT_AUTH_INTENT];
