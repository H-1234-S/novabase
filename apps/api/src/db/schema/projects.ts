import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';

export const projects = pgTable('projects', {
  id: uuid().defaultRandom().primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  // 命名空间
  dbSchema: text('db_schema').notNull().unique(),
  projectUrl: text('project_url').notNull().unique(),
  // 用于Read Operation
  anonKey: text('anon_key').notNull(),
  // 用于 Write Operation
  serviceRoleKey: text('service_role_key').notNull(),
  // project auth
  googleClientId: text('google_client_id'),
  googleClientSecret: text('google_client_secret'),
  githubClientId: text('github_client_id'),
  githubClientSecret: text('github_client_secret'),
  authJwtSecret: text('auth_jwt_secret').notNull(),
  siteUrl: text('site_url'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
