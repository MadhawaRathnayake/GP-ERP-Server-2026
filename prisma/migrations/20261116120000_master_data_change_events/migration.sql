-- hand-written: live master data (customers, suppliers, products), the same way as the documents
-- (20261116110000_document_change_events, whose notify_document_change(channel) sends the row's id on the channel
-- given). Deleting and restoring are updates, so they're announced too; GET /<screen>/by-ids returns deleted rows and
-- clients take them out of their lists.
CREATE TRIGGER "Customer_notify_customer_change"
AFTER INSERT OR UPDATE ON "Customer"
FOR EACH ROW
EXECUTE FUNCTION notify_document_change('customer_change');

CREATE TRIGGER "Supplier_notify_supplier_change"
AFTER INSERT OR UPDATE ON "Supplier"
FOR EACH ROW
EXECUTE FUNCTION notify_document_change('supplier_change');

-- hand-written: not when only the stock changed (with the audit columns a stock change sets): live stock
-- (Product_notify_stock_change) already sends that, and a GRN or invoice with hundreds of lines would otherwise announce
-- every product twice. Two triggers, since an INSERT trigger's WHEN can't read OLD.
CREATE TRIGGER "Product_notify_product_insert"
AFTER INSERT ON "Product"
FOR EACH ROW
EXECUTE FUNCTION notify_document_change('product_change');

CREATE TRIGGER "Product_notify_product_change"
AFTER UPDATE ON "Product"
FOR EACH ROW
WHEN (
  (to_jsonb(OLD) - 'stockInHand' - 'stockVersion' - 'modifiedBy' - 'modifiedAt')
    IS DISTINCT FROM (to_jsonb(NEW) - 'stockInHand' - 'stockVersion' - 'modifiedBy' - 'modifiedAt')
)
EXECUTE FUNCTION notify_document_change('product_change');
