-- CreateEnum
CREATE TYPE "agent_role" AS ENUM ('agent', 'manager');

-- CreateEnum
CREATE TYPE "ticket_priority" AS ENUM ('urgent', 'medium', 'low');

-- CreateEnum
CREATE TYPE "ticket_status" AS ENUM ('new', 'open', 'waiting_on_customer', 'resolved', 'closed');

-- CreateEnum
CREATE TYPE "actor_type" AS ENUM ('agent', 'customer', 'system');

-- CreateEnum
CREATE TYPE "author_type" AS ENUM ('agent', 'customer');

-- CreateTable
CREATE TABLE "agents" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "agent_role" NOT NULL DEFAULT 'agent',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" SERIAL NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "priority" "ticket_priority" NOT NULL,
    "status" "ticket_status" NOT NULL DEFAULT 'new',
    "assignee_id" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "first_response_at" TIMESTAMPTZ(3),
    "resolved_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "reopened_from_id" INTEGER,
    "response_due_at" TIMESTAMPTZ(3),
    "resolve_due_at" TIMESTAMPTZ(3),
    "sla_paused_at" TIMESTAMPTZ(3),

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" SERIAL NOT NULL,
    "ticket_id" INTEGER NOT NULL,
    "author_type" "author_type" NOT NULL,
    "agent_id" INTEGER,
    "customer_id" INTEGER,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "internal_notes" (
    "id" SERIAL NOT NULL,
    "ticket_id" INTEGER NOT NULL,
    "agent_id" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "internal_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_events" (
    "id" SERIAL NOT NULL,
    "ticket_id" INTEGER NOT NULL,
    "actor_type" "actor_type" NOT NULL,
    "actor_id" INTEGER,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("date")
);

-- CreateIndex
CREATE UNIQUE INDEX "agents_email_key" ON "agents"("email");

-- CreateIndex
CREATE UNIQUE INDEX "customers_email_key" ON "customers"("email");

-- CreateIndex
CREATE INDEX "tickets_assignee_id_status_idx" ON "tickets"("assignee_id", "status");

-- CreateIndex
CREATE INDEX "tickets_status_idx" ON "tickets"("status");

-- CreateIndex
CREATE INDEX "tickets_customer_id_idx" ON "tickets"("customer_id");

-- CreateIndex
CREATE INDEX "messages_ticket_id_created_at_idx" ON "messages"("ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "internal_notes_ticket_id_created_at_idx" ON "internal_notes"("ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "ticket_events_ticket_id_occurred_at_idx" ON "ticket_events"("ticket_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_reopened_from_id_fkey" FOREIGN KEY ("reopened_from_id") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_notes" ADD CONSTRAINT "internal_notes_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_notes" ADD CONSTRAINT "internal_notes_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =====================================================================
-- Hand-written additions (Prisma cannot express these in schema.prisma)
-- =====================================================================

-- Every message has exactly one author.
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_chk" CHECK (
    ("author_type" = 'agent'    AND "agent_id"    IS NOT NULL AND "customer_id" IS NULL) OR
    ("author_type" = 'customer' AND "customer_id" IS NOT NULL AND "agent_id"    IS NULL)
);

-- Append-only: the record of what happened can never be changed (INC-0318).
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ticket_events_no_update   BEFORE UPDATE OR DELETE ON "ticket_events"  FOR EACH ROW       EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER ticket_events_no_truncate BEFORE TRUNCATE         ON "ticket_events"  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER messages_no_update        BEFORE UPDATE OR DELETE ON "messages"       FOR EACH ROW       EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER messages_no_truncate      BEFORE TRUNCATE         ON "messages"       FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER notes_no_update           BEFORE UPDATE OR DELETE ON "internal_notes" FOR EACH ROW       EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER notes_no_truncate         BEFORE TRUNCATE         ON "internal_notes" FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- Defence in depth (run once the app role exists; replace frontdesk_app with your role):
-- REVOKE UPDATE, DELETE, TRUNCATE ON "ticket_events", "messages", "internal_notes" FROM frontdesk_app;
