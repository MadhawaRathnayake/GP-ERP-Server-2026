-- hand-written: live delivery notes, internal requisitions, purchase orders and GRNs, the same way as invoices
-- (20261116090000_invoice_change_events). After every insert or update of one of these documents, from any writer,
-- sends its id on the channel the trigger names (read by modules/<name>/<name>.events.ts, streamed by modules/events),
-- so open browsers reload just that row. Postgres delivers it only when the transaction commits (a rollback sends
-- nothing) and drops duplicates within a transaction. Not stored: a listener that is disconnected at that moment misses
-- it, and clients reload the newest documents on the stream's `resync`.
CREATE FUNCTION notify_document_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify(TG_ARGV[0], NEW."id"::text);
  RETURN NULL;
END;
$$;

CREATE TRIGGER "DeliveryNote_notify_delivery_note_change"
AFTER INSERT OR UPDATE ON "DeliveryNote"
FOR EACH ROW
EXECUTE FUNCTION notify_document_change('delivery_note_change');

CREATE TRIGGER "InternalRequisition_notify_internal_requisition_change"
AFTER INSERT OR UPDATE ON "InternalRequisition"
FOR EACH ROW
EXECUTE FUNCTION notify_document_change('internal_requisition_change');

CREATE TRIGGER "PurchaseOrder_notify_purchase_order_change"
AFTER INSERT OR UPDATE ON "PurchaseOrder"
FOR EACH ROW
EXECUTE FUNCTION notify_document_change('purchase_order_change');

CREATE TRIGGER "GoodsReceivedNote_notify_goods_received_note_change"
AFTER INSERT OR UPDATE ON "GoodsReceivedNote"
FOR EACH ROW
EXECUTE FUNCTION notify_document_change('goods_received_note_change');

-- hand-written: a GRN's list row shows its deliveries, so a delivery's change announces its GRN.
CREATE FUNCTION notify_goods_received_note_delivery_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('goods_received_note_change', NEW."goodsReceivedNoteId"::text);
  RETURN NULL;
END;
$$;

CREATE TRIGGER "GoodsReceivedNoteDelivery_notify_goods_received_note_change"
AFTER INSERT OR UPDATE ON "GoodsReceivedNoteDelivery"
FOR EACH ROW
EXECUTE FUNCTION notify_goods_received_note_delivery_change();
