-- hand-written: delivery notes imported from the old system (scripts/import-old-delivery-notes.ts) are marked, and keep
-- the old verifier and issuer names. The old system had names, not users, so an imported issued note may have no
-- verifier or issuer user: DeliveryNote_issued_check lets it. The audit columns are then moved back to the end
-- (AGENTS.md), as in 20261113090000_audit_columns_last; DeliveryNote is still empty when this runs, so no row changes.

ALTER TABLE "DeliveryNote" ADD COLUMN "isImported" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "oldItemVerifierName" TEXT, ADD COLUMN "oldItemIssuerName" TEXT;

ALTER TABLE "DeliveryNote" DROP CONSTRAINT "DeliveryNote_issued_check";
ALTER TABLE "DeliveryNote" ADD CONSTRAINT "DeliveryNote_issued_check" CHECK (
  ("status" <> 'issued' OR "isImported" OR ("itemVerifierId" IS NOT NULL AND "itemIssuerId" IS NOT NULL AND "issuedAt" IS NOT NULL))
  AND ("status" <> 'draft' OR "itemIssuerId" IS NULL)
);

ALTER TABLE "DeliveryNote" DROP CONSTRAINT "DeliveryNote_createdBy_fkey", DROP CONSTRAINT "DeliveryNote_modifiedBy_fkey";
ALTER TABLE "DeliveryNote" RENAME COLUMN "createdBy" TO "_old_createdBy";
ALTER TABLE "DeliveryNote" RENAME COLUMN "createdAt" TO "_old_createdAt";
ALTER TABLE "DeliveryNote" RENAME COLUMN "modifiedBy" TO "_old_modifiedBy";
ALTER TABLE "DeliveryNote" RENAME COLUMN "modifiedAt" TO "_old_modifiedAt";
ALTER TABLE "DeliveryNote" RENAME COLUMN "isDeleted" TO "_old_isDeleted";
ALTER TABLE "DeliveryNote" ADD COLUMN "createdBy" TEXT, ADD COLUMN "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, ADD COLUMN "modifiedBy" TEXT, ADD COLUMN "modifiedAt" TIMESTAMPTZ(3), ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false;
UPDATE "DeliveryNote" SET "createdBy" = "_old_createdBy", "createdAt" = "_old_createdAt", "modifiedBy" = "_old_modifiedBy", "modifiedAt" = "_old_modifiedAt", "isDeleted" = "_old_isDeleted";
ALTER TABLE "DeliveryNote" DROP COLUMN "_old_createdBy", DROP COLUMN "_old_createdAt", DROP COLUMN "_old_modifiedBy", DROP COLUMN "_old_modifiedAt", DROP COLUMN "_old_isDeleted";
ALTER TABLE "DeliveryNote" ADD CONSTRAINT "DeliveryNote_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DeliveryNote" ADD CONSTRAINT "DeliveryNote_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
