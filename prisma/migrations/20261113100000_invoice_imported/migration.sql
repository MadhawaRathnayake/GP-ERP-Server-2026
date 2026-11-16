-- hand-written: invoices imported from the old system are marked, so they can't be cancelled here (their stock and
-- units are as the old system left them). The audit columns are then moved back to the end (AGENTS.md), as in
-- 20261113090000_audit_columns_last; Invoice is still empty when this runs, so no row changes.

ALTER TABLE "Invoice" ADD COLUMN "isImported" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_createdBy_fkey", DROP CONSTRAINT "Invoice_modifiedBy_fkey";
ALTER TABLE "Invoice" RENAME COLUMN "createdBy" TO "_old_createdBy";
ALTER TABLE "Invoice" RENAME COLUMN "createdAt" TO "_old_createdAt";
ALTER TABLE "Invoice" RENAME COLUMN "modifiedBy" TO "_old_modifiedBy";
ALTER TABLE "Invoice" RENAME COLUMN "modifiedAt" TO "_old_modifiedAt";
ALTER TABLE "Invoice" RENAME COLUMN "isDeleted" TO "_old_isDeleted";
ALTER TABLE "Invoice" ADD COLUMN "createdBy" TEXT, ADD COLUMN "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, ADD COLUMN "modifiedBy" TEXT, ADD COLUMN "modifiedAt" TIMESTAMPTZ(3), ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Invoice" SET "createdBy" = "_old_createdBy", "createdAt" = "_old_createdAt", "modifiedBy" = "_old_modifiedBy", "modifiedAt" = "_old_modifiedAt", "isDeleted" = "_old_isDeleted";
ALTER TABLE "Invoice" DROP COLUMN "_old_createdBy", DROP COLUMN "_old_createdAt", DROP COLUMN "_old_modifiedBy", DROP COLUMN "_old_modifiedAt", DROP COLUMN "_old_isDeleted";
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
