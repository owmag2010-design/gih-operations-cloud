-- Extensions needed by the schema. Managed providers (Neon, Supabase, RDS) allow both.
CREATE EXTENSION IF NOT EXISTS citext;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pgcrypto;
