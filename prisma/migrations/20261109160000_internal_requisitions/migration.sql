-- hand-written: internal requisition numbers in the old system's format, GPIR-0001, GPIR-0002, … (padded to 4, longer
-- from GPIR-10000 on: plain lpad would cut it). Numbers never restart, so a sequence (not NumberSequence). The function
-- must exist before the table, whose default calls it. Numbers are never reused.
CREATE SEQUENCE "internal_requisition_number_seq" AS bigint;

CREATE FUNCTION next_internal_requisition_number() RETURNS text LANGUAGE sql AS $$
  SELECT 'GPIR-' || lpad(n::text, greatest(4, length(n::text)), '0')
  FROM (SELECT nextval('internal_requisition_number_seq') AS n) AS next
$$;

-- CreateEnum
CREATE TYPE "InternalRequisitionStatus" AS ENUM ('pending', 'approved', 'rejected', 'cancelled', 'cancelledAfterApproved');

-- CreateTable
CREATE TABLE "InternalRequisition" (
    "id" SERIAL NOT NULL,
    "internalRequisitionNumber" TEXT NOT NULL DEFAULT next_internal_requisition_number(),
    "supplierId" TEXT NOT NULL,
    "status" "InternalRequisitionStatus" NOT NULL DEFAULT 'pending',
    "isInternational" BOOLEAN NOT NULL DEFAULT false,
    "eta" DATE,
    "cancelReason" TEXT,
    "cancelledBy" TEXT,
    "cancelledAt" TIMESTAMPTZ(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedBy" TEXT,
    "modifiedAt" TIMESTAMPTZ(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "InternalRequisition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalRequisitionItem" (
    "id" SERIAL NOT NULL,
    "internalRequisitionId" INTEGER NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "stockInHand" INTEGER NOT NULL,
    "minimumStock" INTEGER NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedBy" TEXT,
    "modifiedAt" TIMESTAMPTZ(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "InternalRequisitionItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InternalRequisition_internalRequisitionNumber_key" ON "InternalRequisition"("internalRequisitionNumber");

-- CreateIndex
CREATE INDEX "InternalRequisition_supplierId_idx" ON "InternalRequisition"("supplierId");

-- CreateIndex
CREATE INDEX "InternalRequisition_status_idx" ON "InternalRequisition"("status");

-- CreateIndex
CREATE INDEX "InternalRequisition_createdAt_idx" ON "InternalRequisition"("createdAt");

-- CreateIndex
CREATE INDEX "InternalRequisitionItem_internalRequisitionId_lineNo_idx" ON "InternalRequisitionItem"("internalRequisitionId", "lineNo");

-- CreateIndex
CREATE INDEX "InternalRequisitionItem_productId_idx" ON "InternalRequisitionItem"("productId");

-- AddForeignKey
ALTER TABLE "InternalRequisition" ADD CONSTRAINT "InternalRequisition_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalRequisition" ADD CONSTRAINT "InternalRequisition_cancelledBy_fkey" FOREIGN KEY ("cancelledBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalRequisition" ADD CONSTRAINT "InternalRequisition_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalRequisition" ADD CONSTRAINT "InternalRequisition_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalRequisitionItem" ADD CONSTRAINT "InternalRequisitionItem_internalRequisitionId_fkey" FOREIGN KEY ("internalRequisitionId") REFERENCES "InternalRequisition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalRequisitionItem" ADD CONSTRAINT "InternalRequisitionItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalRequisitionItem" ADD CONSTRAINT "InternalRequisitionItem_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalRequisitionItem" ADD CONSTRAINT "InternalRequisitionItem_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- hand-written: a cancelled IR says who cancelled it, when and why; any other status has none of the three.
ALTER TABLE "InternalRequisition" ADD CONSTRAINT "InternalRequisition_cancel_check" CHECK (
  CASE WHEN "status" IN ('cancelled', 'cancelledAfterApproved')
    THEN "cancelReason" IS NOT NULL AND "cancelledAt" IS NOT NULL
    ELSE "cancelReason" IS NULL AND "cancelledBy" IS NULL AND "cancelledAt" IS NULL
  END
);

-- hand-written: whole units, at least 1 ordered; the copied stock figures are never negative.
ALTER TABLE "InternalRequisitionItem" ADD CONSTRAINT "InternalRequisitionItem_quantity_check" CHECK (
  "quantity" >= 1 AND "minimumStock" >= 0
);

-- Cache invalidation: notify platform/cache/db-events.plugin.ts on any write (as scripts/migrate.ts adds them)
CREATE TRIGGER "InternalRequisition_notify_change"
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "InternalRequisition"
FOR EACH STATEMENT EXECUTE FUNCTION notify_change();

CREATE TRIGGER "InternalRequisitionItem_notify_change"
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "InternalRequisitionItem"
FOR EACH STATEMENT EXECUTE FUNCTION notify_change();
