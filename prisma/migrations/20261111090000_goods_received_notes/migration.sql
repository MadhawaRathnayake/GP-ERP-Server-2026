-- hand-written: GRN numbers in the old system's format, GPGRN-0001, GPGRN-0002, … (padded to 4, longer from GPGRN-10000
-- on), as next_purchase_order_number() does. The function must exist before the table, whose default calls it. Numbers
-- are never reused.
CREATE SEQUENCE "grn_number_seq" AS bigint;

CREATE FUNCTION next_grn_number() RETURNS text LANGUAGE sql AS $$
  SELECT 'GPGRN-' || lpad(n::text, greatest(4, length(n::text)), '0')
  FROM (SELECT nextval('grn_number_seq') AS n) AS next
$$;

-- CreateEnum
CREATE TYPE "GoodsReceivedNoteStatus" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

-- CreateTable
CREATE TABLE "GoodsReceivedNote" (
    "id" SERIAL NOT NULL,
    "grnNumber" TEXT NOT NULL DEFAULT next_grn_number(),
    "internalRequisitionId" INTEGER NOT NULL,
    "supplierId" TEXT NOT NULL,
    "receivedDate" DATE NOT NULL,
    "supplierInvoiceNumber" TEXT,
    "status" "GoodsReceivedNoteStatus" NOT NULL DEFAULT 'pending',
    "cancelReason" TEXT,
    "cancelledBy" TEXT,
    "cancelledAt" TIMESTAMPTZ(3),
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
    "receivedQuantity" INTEGER NOT NULL,
    "remarks" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedBy" TEXT,
    "modifiedAt" TIMESTAMPTZ(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "GoodsReceivedNoteItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceivedNote_grnNumber_key" ON "GoodsReceivedNote"("grnNumber");

-- CreateIndex
CREATE INDEX "GoodsReceivedNote_internalRequisitionId_idx" ON "GoodsReceivedNote"("internalRequisitionId");

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

-- AddForeignKey
ALTER TABLE "GoodsReceivedNote" ADD CONSTRAINT "GoodsReceivedNote_internalRequisitionId_fkey" FOREIGN KEY ("internalRequisitionId") REFERENCES "InternalRequisition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceivedNote" ADD CONSTRAINT "GoodsReceivedNote_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceivedNote" ADD CONSTRAINT "GoodsReceivedNote_cancelledBy_fkey" FOREIGN KEY ("cancelledBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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


-- hand-written: one open (pending or rejected) GRN per order, so outstanding quantities can't be received twice.
CREATE UNIQUE INDEX "GoodsReceivedNote_one_open_per_requisition" ON "GoodsReceivedNote"("internalRequisitionId")
  WHERE "status" IN ('pending', 'rejected') AND NOT "isDeleted";

-- hand-written: a cancelled GRN says who cancelled it, when and why; any other status has none of the three.
ALTER TABLE "GoodsReceivedNote" ADD CONSTRAINT "GoodsReceivedNote_cancel_check" CHECK (
  CASE WHEN "status" = 'cancelled'
    THEN "cancelReason" IS NOT NULL AND "cancelledAt" IS NOT NULL
    ELSE "cancelReason" IS NULL AND "cancelledBy" IS NULL AND "cancelledAt" IS NULL
  END
);

-- hand-written: whole units; an order line has at least 1, a delivery 0 or more of it.
ALTER TABLE "GoodsReceivedNoteItem" ADD CONSTRAINT "GoodsReceivedNoteItem_quantity_check" CHECK (
  "orderedQuantity" >= 1 AND "receivedQuantity" >= 0
);

-- Cache invalidation: notify platform/cache/db-events.plugin.ts on any write (as scripts/migrate.ts adds them)
CREATE TRIGGER "GoodsReceivedNote_notify_change"
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "GoodsReceivedNote"
FOR EACH STATEMENT EXECUTE FUNCTION notify_change();

CREATE TRIGGER "GoodsReceivedNoteItem_notify_change"
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "GoodsReceivedNoteItem"
FOR EACH STATEMENT EXECUTE FUNCTION notify_change();
