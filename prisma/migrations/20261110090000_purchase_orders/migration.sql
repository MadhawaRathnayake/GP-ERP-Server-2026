-- hand-written: purchase order numbers in the old system's format, GPPO-0001, GPPO-0002, … (padded to 4, longer from
-- GPPO-10000 on), as next_internal_requisition_number() does. The function must exist before the table, whose default
-- calls it. Numbers are never reused.
CREATE SEQUENCE "purchase_order_number_seq" AS bigint;

CREATE FUNCTION next_purchase_order_number() RETURNS text LANGUAGE sql AS $$
  SELECT 'GPPO-' || lpad(n::text, greatest(4, length(n::text)), '0')
  FROM (SELECT nextval('purchase_order_number_seq') AS n) AS next
$$;

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('pending', 'approved', 'rejected', 'completed', 'cancelled', 'cancelledAfterApproved');

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" SERIAL NOT NULL,
    "purchaseOrderNumber" TEXT NOT NULL DEFAULT next_purchase_order_number(),
    "internalRequisitionId" INTEGER NOT NULL,
    "supplierId" TEXT NOT NULL,
    "purchaseOrderDate" DATE NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'pending',
    "comments" TEXT,
    "remarks" TEXT,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cancelReason" TEXT,
    "cancelledBy" TEXT,
    "cancelledAt" TIMESTAMPTZ(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedBy" TEXT,
    "modifiedAt" TIMESTAMPTZ(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderItem" (
    "id" SERIAL NOT NULL,
    "purchaseOrderId" INTEGER NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "discountType" "DiscountType" NOT NULL DEFAULT 'none',
    "discountValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "discountAmount" DECIMAL(14,2) NOT NULL,
    "taxAmount" DECIMAL(14,2) NOT NULL,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedBy" TEXT,
    "modifiedAt" TIMESTAMPTZ(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_purchaseOrderNumber_key" ON "PurchaseOrder"("purchaseOrderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_internalRequisitionId_key" ON "PurchaseOrder"("internalRequisitionId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");

-- CreateIndex
CREATE INDEX "PurchaseOrder_createdAt_idx" ON "PurchaseOrder"("createdAt");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_purchaseOrderId_lineNo_idx" ON "PurchaseOrderItem"("purchaseOrderId", "lineNo");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_productId_idx" ON "PurchaseOrderItem"("productId");

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_internalRequisitionId_fkey" FOREIGN KEY ("internalRequisitionId") REFERENCES "InternalRequisition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_cancelledBy_fkey" FOREIGN KEY ("cancelledBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- hand-written: a cancelled PO says who cancelled it, when and why; any other status has none of the three.
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_cancel_check" CHECK (
  CASE WHEN "status" IN ('cancelled', 'cancelledAfterApproved')
    THEN "cancelReason" IS NOT NULL AND "cancelledAt" IS NOT NULL
    ELSE "cancelReason" IS NULL AND "cancelledBy" IS NULL AND "cancelledAt" IS NULL
  END
);

-- hand-written: whole units, at least 1; a price above 0; a discount and VAT rate that make sense.
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_amounts_check" CHECK (
  "quantity" >= 1 AND "unitPrice" > 0 AND "discountValue" >= 0 AND "taxRate" BETWEEN 0 AND 100
  AND ("discountType" <> 'none' OR "discountValue" = 0)
  AND ("discountType" <> 'percentage' OR "discountValue" <= 100)
);

-- Cache invalidation: notify platform/cache/db-events.plugin.ts on any write (as scripts/migrate.ts adds them)
CREATE TRIGGER "PurchaseOrder_notify_change"
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "PurchaseOrder"
FOR EACH STATEMENT EXECUTE FUNCTION notify_change();

CREATE TRIGGER "PurchaseOrderItem_notify_change"
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "PurchaseOrderItem"
FOR EACH STATEMENT EXECUTE FUNCTION notify_change();
