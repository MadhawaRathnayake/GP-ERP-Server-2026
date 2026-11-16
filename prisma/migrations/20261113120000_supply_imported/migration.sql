-- hand-written: for the old system's internal requisitions, purchase orders and GRNs (scripts/import-old-supply.ts).
-- 1. GoodsReceivedNoteDelivery.isImported: a delivery recorded in the old system. Its goods were put in stock there, so
--    its serial-tracked units aren't asked for serials here (adding them would count the stock twice).
-- 2. GoodsReceivedNoteItem_quantity_check no longer caps receivedQuantity at orderedQuantity: an old order received
--    more than it ordered (GPIR-0105, two shipments of 205 on an order of 205). New deliveries are still held to what's
--    outstanding by goods-received-notes.service.ts.
-- 3. The audit columns are moved back to the end (AGENTS.md), as in 20261113090000_audit_columns_last; the GRN tables are
--    still empty when this runs, so no row changes.

ALTER TABLE "GoodsReceivedNoteDelivery" ADD COLUMN "isImported" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "GoodsReceivedNoteItem" DROP CONSTRAINT "GoodsReceivedNoteItem_quantity_check";
ALTER TABLE "GoodsReceivedNoteItem" ADD CONSTRAINT "GoodsReceivedNoteItem_quantity_check" CHECK ("orderedQuantity" >= 1 AND "receivedQuantity" >= 0);

ALTER TABLE "GoodsReceivedNoteDelivery" DROP CONSTRAINT "GoodsReceivedNoteDelivery_createdBy_fkey", DROP CONSTRAINT "GoodsReceivedNoteDelivery_modifiedBy_fkey";
ALTER TABLE "GoodsReceivedNoteDelivery" RENAME COLUMN "createdBy" TO "_old_createdBy";
ALTER TABLE "GoodsReceivedNoteDelivery" RENAME COLUMN "createdAt" TO "_old_createdAt";
ALTER TABLE "GoodsReceivedNoteDelivery" RENAME COLUMN "modifiedBy" TO "_old_modifiedBy";
ALTER TABLE "GoodsReceivedNoteDelivery" RENAME COLUMN "modifiedAt" TO "_old_modifiedAt";
ALTER TABLE "GoodsReceivedNoteDelivery" RENAME COLUMN "isDeleted" TO "_old_isDeleted";
ALTER TABLE "GoodsReceivedNoteDelivery" ADD COLUMN "createdBy" TEXT, ADD COLUMN "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, ADD COLUMN "modifiedBy" TEXT, ADD COLUMN "modifiedAt" TIMESTAMPTZ(3), ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false;
UPDATE "GoodsReceivedNoteDelivery" SET "createdBy" = "_old_createdBy", "createdAt" = "_old_createdAt", "modifiedBy" = "_old_modifiedBy", "modifiedAt" = "_old_modifiedAt", "isDeleted" = "_old_isDeleted";
ALTER TABLE "GoodsReceivedNoteDelivery" DROP COLUMN "_old_createdBy", DROP COLUMN "_old_createdAt", DROP COLUMN "_old_modifiedBy", DROP COLUMN "_old_modifiedAt", DROP COLUMN "_old_isDeleted";
ALTER TABLE "GoodsReceivedNoteDelivery" ADD CONSTRAINT "GoodsReceivedNoteDelivery_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GoodsReceivedNoteDelivery" ADD CONSTRAINT "GoodsReceivedNoteDelivery_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
