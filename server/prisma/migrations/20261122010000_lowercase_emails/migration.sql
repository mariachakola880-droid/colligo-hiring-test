-- Emails are stored in one canonical (lowercase) form, so login lookups always match.
-- Not expressible in schema.prisma; added by hand.

-- Existing rows first (e.g. test agents created before this rule existed)
UPDATE "agents" SET "email" = lower("email") WHERE "email" <> lower("email");
UPDATE "customers" SET "email" = lower("email") WHERE "email" <> lower("email");

ALTER TABLE "agents" ADD CONSTRAINT "agents_email_lowercase" CHECK ("email" = lower("email"));
ALTER TABLE "customers" ADD CONSTRAINT "customers_email_lowercase" CHECK ("email" = lower("email"));
