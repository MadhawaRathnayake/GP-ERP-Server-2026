-- hand-written: live quotations (modules/quotations/quotations.events.ts, streamed by modules/events). After every
-- insert or update of a quotation (deleting and restoring are updates), from any writer, sends its id on channel
-- quotation_change, so open browsers reload just that row. Postgres delivers it only when the transaction commits (a
-- rollback sends nothing) and drops duplicates within a transaction, so several updates of one quotation send one
-- notification. Not stored: a listener that is disconnected at that moment misses it, and clients reload the newest
-- quotations on the stream's `resync`.
CREATE FUNCTION notify_quotation_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('quotation_change', NEW."id"::text);
  RETURN NULL;
END;
$$;

CREATE TRIGGER "Quotation_notify_quotation_change"
AFTER INSERT OR UPDATE ON "Quotation"
FOR EACH ROW
EXECUTE FUNCTION notify_quotation_change();
