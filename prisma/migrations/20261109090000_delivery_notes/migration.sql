-- hand-written: delivery note numbers in the old system's format, GPDN-1, GPDN-2, … (no padding). The function must
-- exist before the table, whose default calls it. Numbers are never reused.
CREATE SEQUENCE "delivery_note_number_seq" AS bigint;

CREATE FUNCTION next_delivery_note_number() RETURNS text LANGUAGE sql AS $$
  SELECT 'GPDN-' || nextval('delivery_note_number_seq')
$$;

-- CreateEnum
CREATE TYPE "DeliveryNoteStatus" AS ENUM ('draft', 'issued', 'cancelled');

-- CreateTable
CREATE TABLE "DeliveryNote" (
    "id" SERIAL NOT NULL,
    "deliveryNoteNumber" TEXT NOT NULL DEFAULT next_delivery_note_number(),
    "invoiceId" INTEGER NOT NULL,
    "status" "DeliveryNoteStatus" NOT NULL DEFAULT 'draft',
    "itemVerifierId" TEXT,
    "itemIssuerId" TEXT,
    "issuedAt" TIMESTAMPTZ(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedBy" TEXT,
    "modifiedAt" TIMESTAMPTZ(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DeliveryNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryNote_deliveryNoteNumber_key" ON "DeliveryNote"("deliveryNoteNumber");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryNote_invoiceId_key" ON "DeliveryNote"("invoiceId");

-- CreateIndex
CREATE INDEX "DeliveryNote_status_idx" ON "DeliveryNote"("status");

-- CreateIndex
CREATE INDEX "DeliveryNote_itemVerifierId_idx" ON "DeliveryNote"("itemVerifierId");

-- CreateIndex
CREATE INDEX "DeliveryNote_itemIssuerId_idx" ON "DeliveryNote"("itemIssuerId");

-- AddForeignKey
ALTER TABLE "DeliveryNote" ADD CONSTRAINT "DeliveryNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryNote" ADD CONSTRAINT "DeliveryNote_itemVerifierId_fkey" FOREIGN KEY ("itemVerifierId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryNote" ADD CONSTRAINT "DeliveryNote_itemIssuerId_fkey" FOREIGN KEY ("itemIssuerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryNote" ADD CONSTRAINT "DeliveryNote_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryNote" ADD CONSTRAINT "DeliveryNote_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- hand-written: the item verifier and the item issuer are two different users (the API checks it too).
ALTER TABLE "DeliveryNote" ADD CONSTRAINT "DeliveryNote_people_check" CHECK ("itemIssuerId" IS DISTINCT FROM "itemVerifierId" OR "itemIssuerId" IS NULL);

-- hand-written: an issued note has both people and the time it was issued; a draft has no issuer yet.
ALTER TABLE "DeliveryNote" ADD CONSTRAINT "DeliveryNote_issued_check" CHECK (
  ("status" <> 'issued' OR ("itemVerifierId" IS NOT NULL AND "itemIssuerId" IS NOT NULL AND "issuedAt" IS NOT NULL))
  AND ("status" <> 'draft' OR "itemIssuerId" IS NULL)
);

-- Cache invalidation: notify platform/cache/db-events.plugin.ts on any write (as scripts/migrate.ts adds them)
CREATE TRIGGER "DeliveryNote_notify_change"
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "DeliveryNote"
FOR EACH STATEMENT EXECUTE FUNCTION notify_change();
