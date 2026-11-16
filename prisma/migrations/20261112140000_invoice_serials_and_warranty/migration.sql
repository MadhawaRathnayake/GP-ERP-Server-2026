-- hand-written: serial numbers on invoices and the warranty on invoice lines (docs/plans/serial-numbers.md §3.5).
-- The warehouse scans each unit on the draft; finalizing needs them all and sells them. Warranty starts on the invoice.

-- AlterTable. hand-written: InvoiceItem has data, so the columns are added (after the audit columns in the database,
-- like Role.isSystem); existing lines take their product's warranty, and the default goes again (the app always sets it).
ALTER TABLE "InvoiceItem" ADD COLUMN "warrantyEndsAt" DATE,
ADD COLUMN "warrantyMonths" INTEGER NOT NULL DEFAULT 0;

UPDATE "InvoiceItem" AS i SET "warrantyMonths" = p."warrantyMonths" FROM "Product" AS p WHERE p."id" = i."productId";

ALTER TABLE "InvoiceItem" ALTER COLUMN "warrantyMonths" DROP DEFAULT;

-- CreateTable
CREATE TABLE "InvoiceSerialItem" (
    "id" SERIAL NOT NULL,
    "invoiceId" INTEGER NOT NULL,
    "productId" TEXT NOT NULL,
    "serialItemId" INTEGER NOT NULL,
    "releasedAt" TIMESTAMPTZ(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedBy" TEXT,
    "modifiedAt" TIMESTAMPTZ(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "InvoiceSerialItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvoiceSerialItem_invoiceId_idx" ON "InvoiceSerialItem"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceSerialItem_serialItemId_idx" ON "InvoiceSerialItem"("serialItemId");

-- AddForeignKey
ALTER TABLE "InvoiceSerialItem" ADD CONSTRAINT "InvoiceSerialItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceSerialItem" ADD CONSTRAINT "InvoiceSerialItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceSerialItem" ADD CONSTRAINT "InvoiceSerialItem_serialItemId_fkey" FOREIGN KEY ("serialItemId") REFERENCES "SerialItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceSerialItem" ADD CONSTRAINT "InvoiceSerialItem_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceSerialItem" ADD CONSTRAINT "InvoiceSerialItem_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- hand-written: a unit is on one live pick at a time (a draft reserves it; a finalized invoice keeps it).
CREATE UNIQUE INDEX "InvoiceSerialItem_serialItemId_live_key" ON "InvoiceSerialItem"("serialItemId") WHERE "releasedAt" IS NULL AND NOT "isDeleted";

-- Cache invalidation: notify platform/cache/db-events.plugin.ts on any write to "InvoiceSerialItem" (added by scripts/migrate.ts)
CREATE TRIGGER "InvoiceSerialItem_notify_change"
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "InvoiceSerialItem"
FOR EACH STATEMENT EXECUTE FUNCTION notify_change();
