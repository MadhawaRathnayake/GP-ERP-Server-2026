-- hand-written: the old-invoice and old-serial references of service and warranty quotations and invoices become links
-- (docs/plans/serial-numbers.md §3.7): an id with a foreign key, and the number copied next to it. The text columns are
-- renamed to the number columns, so what is there (old-system numbers on imported quotations) is kept, with no link
-- until the old data is imported; the id columns are new (after the audit columns, like Role.isSystem).

-- The type CHECKs name the old columns, so they go first and come back for the new ones.
ALTER TABLE "Quotation" DROP CONSTRAINT "Quotation_type_fields_check";
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_type_fields_check";

ALTER TABLE "Quotation" RENAME COLUMN "oldInvoiceId" TO "oldInvoiceNumber";
ALTER TABLE "Quotation" RENAME COLUMN "oldSerialNumberId" TO "oldSerialNumber";
ALTER TABLE "Quotation" ADD COLUMN "oldInvoiceId" INTEGER, ADD COLUMN "oldSerialItemId" INTEGER;

ALTER TABLE "Invoice" RENAME COLUMN "oldInvoiceId" TO "oldInvoiceNumber";
ALTER TABLE "Invoice" RENAME COLUMN "oldSerialNumberId" TO "oldSerialNumber";
ALTER TABLE "Invoice" ADD COLUMN "oldInvoiceId" INTEGER, ADD COLUMN "oldSerialItemId" INTEGER;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_oldInvoiceId_fkey" FOREIGN KEY ("oldInvoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_oldSerialItemId_fkey" FOREIGN KEY ("oldSerialItemId") REFERENCES "SerialItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_oldInvoiceId_fkey" FOREIGN KEY ("oldInvoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_oldSerialItemId_fkey" FOREIGN KEY ("oldSerialItemId") REFERENCES "SerialItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- hand-written: as before, with the new columns: the references are null on the types that don't have them, and a
-- link always has its number.
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_type_fields_check" CHECK (
  ("type" = 'service' OR "repairReceiveNoteId" IS NULL)
  AND ("type" = 'warranty' OR ("troubleshootId" IS NULL AND "productModel" IS NULL))
  AND ("type" IN ('service', 'warranty')
    OR ("oldInvoiceId" IS NULL AND "oldInvoiceNumber" IS NULL AND "oldSerialItemId" IS NULL AND "oldSerialNumber" IS NULL))
  AND ("oldInvoiceId" IS NULL OR "oldInvoiceNumber" IS NOT NULL)
  AND ("oldSerialItemId" IS NULL OR "oldSerialNumber" IS NOT NULL)
);

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_type_fields_check" CHECK (
  ("type" = 'service' OR "repairReceiveNoteId" IS NULL)
  AND ("type" = 'warranty' OR ("troubleshootId" IS NULL AND "productModel" IS NULL))
  AND ("type" IN ('service', 'warranty')
    OR ("oldInvoiceId" IS NULL AND "oldInvoiceNumber" IS NULL AND "oldSerialItemId" IS NULL AND "oldSerialNumber" IS NULL))
  AND ("oldInvoiceId" IS NULL OR "oldInvoiceNumber" IS NOT NULL)
  AND ("oldSerialItemId" IS NULL OR "oldSerialNumber" IS NOT NULL)
);
