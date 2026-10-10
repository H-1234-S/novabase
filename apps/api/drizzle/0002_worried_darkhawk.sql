ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "google_client_id" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "google_client_secret" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "github_client_id" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "github_client_secret" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "auth_jwt_secret" text;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "auth_jwt_secret" SET DEFAULT md5(random()::text || clock_timestamp()::text);--> statement-breakpoint
UPDATE "projects" SET "auth_jwt_secret" = md5(random()::text || clock_timestamp()::text) WHERE "auth_jwt_secret" IS NULL;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "auth_jwt_secret" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "site_url" text;