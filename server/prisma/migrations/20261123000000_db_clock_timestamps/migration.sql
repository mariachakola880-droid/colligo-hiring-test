-- INC-0318: the times in the record come from the database clock, never the app server's.
--
-- Prisma fills in @default(now()) itself and sends the app server's time with each
-- INSERT, so the column DEFAULT alone does not guarantee this. These triggers overwrite
-- the timestamp on every insert, whatever the app sends, which also stops backdating.
--
-- The one exception is the demo seed, which backdates tickets so the demo has late ones
-- to show. It turns the override off for its own transaction only:
--   SELECT set_config('frontdesk.allow_backdate', 'on', true)
-- No application code sets this. The setting ends with the transaction.
-- (Like any trigger, a database administrator can still bypass this.)

CREATE OR REPLACE FUNCTION stamp_created_at() RETURNS trigger AS $$
BEGIN
    IF current_setting('frontdesk.allow_backdate', true) IS DISTINCT FROM 'on' THEN
        NEW."created_at" := now();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stamp_occurred_at() RETURNS trigger AS $$
BEGIN
    IF current_setting('frontdesk.allow_backdate', true) IS DISTINCT FROM 'on' THEN
        NEW."occurred_at" := now();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ticket_events_db_time  BEFORE INSERT ON "ticket_events"  FOR EACH ROW EXECUTE FUNCTION stamp_occurred_at();
CREATE TRIGGER messages_db_time       BEFORE INSERT ON "messages"       FOR EACH ROW EXECUTE FUNCTION stamp_created_at();
CREATE TRIGGER internal_notes_db_time BEFORE INSERT ON "internal_notes" FOR EACH ROW EXECUTE FUNCTION stamp_created_at();
-- The SLA clock counts from a ticket's creation, so that time gets the same guarantee
CREATE TRIGGER tickets_db_time        BEFORE INSERT ON "tickets"        FOR EACH ROW EXECUTE FUNCTION stamp_created_at();
