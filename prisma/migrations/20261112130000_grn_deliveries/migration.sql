-- hand-written: GRNs become one per order, received in batches (deliveries), without approval, with serial numbers as
-- the last step (docs/plans/serial-numbers.md §3.10). The GRN tables change shape, so they are dropped and made again;
-- that is only safe while they are empty, so the migration stops if any GRN exists. next_grn_number() and its sequence
-- stay.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "GoodsReceivedNote") THEN
    RAISE EXCEPTION 'GoodsReceivedNote has rows: convert them before this migration (docs/plans/serial-numbers.md §3.10)';
  END IF;
END $$;

DROP TABLE "GoodsReceivedNoteItem";
DROP TABLE "GoodsReceivedNote";
DROP TYPE "GoodsReceivedNoteStatus";

-- hand-written: no approval for GRNs any more. Their EDIT, APPROVE, REJECT and CANCEL permissions go (grants go with
-- them, ON DELETE CASCADE), as do the approval switch and any decisions recorded for GRNs.
DELETE FROM "Permission" WHERE "screenCode" = 'GOODS_RECEIVED_NOTES' AND "permissionCode" IN ('EDIT', 'APPROVE', 'REJECT', 'CANCEL');
DELETE FROM "ApprovalRule" WHERE "id" = 'GOODS_RECEIVED_NOTES';
DELETE FROM "Approval" WHERE "screen" = 'GOODS_RECEIVED_NOTES';

-- CreateEnum
CREATE TYPE "GoodsReceivedNoteStatus" AS ENUM ('partiallyCompleted', 'needSerialNumbers', 'completed');

-- CreateTable
CREATE TABLE "GoodsReceivedNote" (
    "id" SERIAL NOT NULL,
    "grnNumber" TEXT NOT NULL DEFAULT next_grn_number(),
    "internalRequisitionId" INTEGER NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" "GoodsReceivedNoteStatus" NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedBy" TEXT,
    "modifiedAt" TIMESTAMPTZ(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "GoodsReceivedNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceivedNoteItem" (
    "id" SERIAL NOT NULL,
    "goodsReceivedNoteId" INTEGER NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "productId" TEXT NOT NULL,
    "orderedQuantity" INTEGER NOT NULL,
    "receivedQuantity" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedBy" TEXT,
    "modifiedAt" TIMESTAMPTZ(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "GoodsReceivedNoteItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceivedNoteDelivery" (
    "id" SERIAL NOT NULL,
    "goodsReceivedNoteId" INTEGER NOT NULL,
    "deliveryNo" INTEGER NOT NULL,
    "receivedDate" DATE NOT NULL,
    "supplierInvoiceNumber" TEXT,
    "remarks" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedBy" TEXT,
    "modifiedAt" TIMESTAMPTZ(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "GoodsReceivedNoteDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceivedNoteDeliveryItem" (
    "id" SERIAL NOT NULL,
    "deliveryId" INTEGER NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "remarks" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedBy" TEXT,
    "modifiedAt" TIMESTAMPTZ(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "GoodsReceivedNoteDeliveryItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceivedNote_grnNumber_key" ON "GoodsReceivedNote"("grnNumber");

-- CreateIndex
CREATE INDEX "GoodsReceivedNote_supplierId_idx" ON "GoodsReceivedNote"("supplierId");

-- CreateIndex
CREATE INDEX "GoodsReceivedNote_status_idx" ON "GoodsReceivedNote"("status");

-- CreateIndex
CREATE INDEX "GoodsReceivedNote_createdAt_idx" ON "GoodsReceivedNote"("createdAt");

-- CreateIndex
CREATE INDEX "GoodsReceivedNoteItem_goodsReceivedNoteId_lineNo_idx" ON "GoodsReceivedNoteItem"("goodsReceivedNoteId", "lineNo");

-- CreateIndex
CREATE INDEX "GoodsReceivedNoteItem_productId_idx" ON "GoodsReceivedNoteItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceivedNoteDelivery_goodsReceivedNoteId_deliveryNo_key" ON "GoodsReceivedNoteDelivery"("goodsReceivedNoteId", "deliveryNo");

-- CreateIndex
CREATE INDEX "GoodsReceivedNoteDeliveryItem_deliveryId_idx" ON "GoodsReceivedNoteDeliveryItem"("deliveryId");

-- CreateIndex
CREATE INDEX "GoodsReceivedNoteDeliveryItem_productId_idx" ON "GoodsReceivedNoteDeliveryItem"("productId");

-- AddForeignKey
ALTER TABLE "SerialItem" ADD CONSTRAINT "SerialItem_goodsReceivedNoteDeliveryId_fkey" FOREIGN KEY ("goodsReceivedNoteDeliveryId") REFERENCES "GoodsReceivedNoteDelivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SerialItemMovement" ADD CONSTRAINT "SerialItemMovement_goodsReceivedNoteDeliveryId_fkey" FOREIGN KEY ("goodsReceivedNoteDeliveryId") REFERENCES "GoodsReceivedNoteDelivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceivedNote" ADD CONSTRAINT "GoodsReceivedNote_internalRequisitionId_fkey" FOREIGN KEY ("internalRequisitionId") REFERENCES "InternalRequisition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceivedNote" ADD CONSTRAINT "GoodsReceivedNote_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceivedNote" ADD CONSTRAINT "GoodsReceivedNote_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceivedNote" ADD CONSTRAINT "GoodsReceivedNote_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceivedNoteItem" ADD CONSTRAINT "GoodsReceivedNoteItem_goodsReceivedNoteId_fkey" FOREIGN KEY ("goodsReceivedNoteId") REFERENCES "GoodsReceivedNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceivedNoteItem" ADD CONSTRAINT "GoodsReceivedNoteItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceivedNoteItem" ADD CONSTRAINT "GoodsReceivedNoteItem_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceivedNoteItem" ADD CONSTRAINT "GoodsReceivedNoteItem_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceivedNoteDelivery" ADD CONSTRAINT "GoodsReceivedNoteDelivery_goodsReceivedNoteId_fkey" FOREIGN KEY ("goodsReceivedNoteId") REFERENCES "GoodsReceivedNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceivedNoteDelivery" ADD CONSTRAINT "GoodsReceivedNoteDelivery_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceivedNoteDelivery" ADD CONSTRAINT "GoodsReceivedNoteDelivery_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceivedNoteDeliveryItem" ADD CONSTRAINT "GoodsReceivedNoteDeliveryItem_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "GoodsReceivedNoteDelivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceivedNoteDeliveryItem" ADD CONSTRAINT "GoodsReceivedNoteDeliveryItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceivedNoteDeliveryItem" ADD CONSTRAINT "GoodsReceivedNoteDeliveryItem_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceivedNoteDeliveryItem" ADD CONSTRAINT "GoodsReceivedNoteDeliveryItem_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- hand-written: one GRN per order.
CREATE UNIQUE INDEX "GoodsReceivedNote_one_per_requisition" ON "GoodsReceivedNote"("internalRequisitionId") WHERE NOT "isDeleted";

-- hand-written: what arrives never goes past what was ordered, and a delivery line brings something.
ALTER TABLE "GoodsReceivedNoteItem" ADD CONSTRAINT "GoodsReceivedNoteItem_quantity_check"
  CHECK ("orderedQuantity" >= 1 AND "receivedQuantity" >= 0 AND "receivedQuantity" <= "orderedQuantity");
ALTER TABLE "GoodsReceivedNoteDeliveryItem" ADD CONSTRAINT "GoodsReceivedNoteDeliveryItem_quantity_check" CHECK ("quantity" >= 1);

-- Cache invalidation: notify platform/cache/db-events.plugin.ts on any write to "GoodsReceivedNote" (added by scripts/migrate.ts)
CREATE TRIGGER "GoodsReceivedNote_notify_change"
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "GoodsReceivedNote"
FOR EACH STATEMENT EXECUTE FUNCTION notify_change();

-- Cache invalidation: notify platform/cache/db-events.plugin.ts on any write to "GoodsReceivedNoteItem" (added by scripts/migrate.ts)
CREATE TRIGGER "GoodsReceivedNoteItem_notify_change"
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "GoodsReceivedNoteItem"
FOR EACH STATEMENT EXECUTE FUNCTION notify_change();

-- Cache invalidation: notify platform/cache/db-events.plugin.ts on any write to "GoodsReceivedNoteDelivery" (added by scripts/migrate.ts)
CREATE TRIGGER "GoodsReceivedNoteDelivery_notify_change"
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "GoodsReceivedNoteDelivery"
FOR EACH STATEMENT EXECUTE FUNCTION notify_change();

-- Cache invalidation: notify platform/cache/db-events.plugin.ts on any write to "GoodsReceivedNoteDeliveryItem" (added by scripts/migrate.ts)
CREATE TRIGGER "GoodsReceivedNoteDeliveryItem_notify_change"
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "GoodsReceivedNoteDeliveryItem"
FOR EACH STATEMENT EXECUTE FUNCTION notify_change();
