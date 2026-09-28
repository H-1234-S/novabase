export const PROJECTS_INTENT = {
  CREATE: 'CREATE',
} as const;

export type ProjectsIntent =
  (typeof PROJECTS_INTENT)[keyof typeof PROJECTS_INTENT];
