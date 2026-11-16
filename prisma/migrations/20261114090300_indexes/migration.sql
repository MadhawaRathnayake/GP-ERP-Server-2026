-- hand-written: indexes from the schema review.
--   - Foreign keys that had no index (Postgres doesn't make one), and the invoice dates reports filter on.
--   - Lists filter by status and show the newest first, so (status, id) replaces the status index; the quotation type
--     index (3 values) and the indexes on Customer.id / Supplier.id (the primary key already is one) are dropped.
--   - pg_trgm GIN indexes for the case-insensitive `contains` searches (ILIKE '%…%'), which a b-tree index can't serve.
--     CREATE EXTENSION needs the CREATE privilege on the database (pg_trgm is a trusted extension).

-- Foreign keys and dates
CREATE INDEX "Quotation_oldInvoiceId_idx" ON "Quotation"("oldInvoiceId");
CREATE INDEX "Quotation_oldSerialItemId_idx" ON "Quotation"("oldSerialItemId");
CREATE INDEX "Quotation_confirmedById_idx" ON "Quotation"("confirmedById");
CREATE INDEX "Invoice_oldInvoiceId_idx" ON "Invoice"("oldInvoiceId");
CREATE INDEX "Invoice_oldSerialItemId_idx" ON "Invoice"("oldSerialItemId");
CREATE INDEX "Invoice_finalizedBy_idx" ON "Invoice"("finalizedBy");
CREATE INDEX "Invoice_cancelledBy_idx" ON "Invoice"("cancelledBy");
CREATE INDEX "Invoice_finalizedAt_idx" ON "Invoice"("finalizedAt");
CREATE INDEX "Invoice_dueDate_idx" ON "Invoice"("dueDate");
CREATE INDEX "SerialItemMovement_invoiceId_idx" ON "SerialItemMovement"("invoiceId");
CREATE INDEX "SerialItemMovement_goodsReceivedNoteDeliveryId_idx" ON "SerialItemMovement"("goodsReceivedNoteDeliveryId");
CREATE INDEX "InvoiceSerialItem_productId_idx" ON "InvoiceSerialItem"("productId");
CREATE INDEX "Accessory_productId_idx" ON "Accessory"("productId");

-- Status lists
DROP INDEX "Quotation_status_idx";
DROP INDEX "Quotation_type_idx";
DROP INDEX "Invoice_status_idx";
DROP INDEX "DeliveryNote_status_idx";
DROP INDEX "InternalRequisition_status_idx";
DROP INDEX "PurchaseOrder_status_idx";
DROP INDEX "GoodsReceivedNote_status_idx";
CREATE INDEX "Quotation_status_id_idx" ON "Quotation"("status", "id");
CREATE INDEX "Invoice_status_id_idx" ON "Invoice"("status", "id");
CREATE INDEX "DeliveryNote_status_id_idx" ON "DeliveryNote"("status", "id");
CREATE INDEX "InternalRequisition_status_id_idx" ON "InternalRequisition"("status", "id");
CREATE INDEX "PurchaseOrder_status_id_idx" ON "PurchaseOrder"("status", "id");
CREATE INDEX "GoodsReceivedNote_status_id_idx" ON "GoodsReceivedNote"("status", "id");

-- Redundant
DROP INDEX "Customer_id_idx";
DROP INDEX "Supplier_id_idx";

-- Text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "Customer_code_trgm_idx" ON "Customer" USING GIN ("code" gin_trgm_ops);
CREATE INDEX "Customer_name_trgm_idx" ON "Customer" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "Customer_email_trgm_idx" ON "Customer" USING GIN ("email" gin_trgm_ops);
CREATE INDEX "Supplier_name_trgm_idx" ON "Supplier" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "Supplier_email_trgm_idx" ON "Supplier" USING GIN ("email" gin_trgm_ops);
CREATE INDEX "Product_sku_trgm_idx" ON "Product" USING GIN ("sku" gin_trgm_ops);
CREATE INDEX "Product_title_trgm_idx" ON "Product" USING GIN ("title" gin_trgm_ops);
