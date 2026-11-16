-- hand-written: live invoices (modules/invoices/invoices.events.ts, streamed by modules/events). After every insert or
-- update of an invoice, from any writer, sends its id on channel invoice_change, so open browsers reload just that row.
-- Postgres delivers it only when the transaction commits (a rollback sends nothing) and drops duplicates within a
-- transaction, so several updates of one invoice send one notification. Not stored: a listener that is disconnected
-- at that moment misses it, and clients reload the newest invoices on the stream's `resync`.
CREATE FUNCTION notify_invoice_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('invoice_change', NEW."id"::text);
  RETURN NULL;
END;
$$;

CREATE TRIGGER "Invoice_notify_invoice_change"
AFTER INSERT OR UPDATE ON "Invoice"
FOR EACH ROW
EXECUTE FUNCTION notify_invoice_change();
