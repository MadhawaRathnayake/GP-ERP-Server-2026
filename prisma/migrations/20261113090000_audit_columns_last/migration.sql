-- hand-written: puts the audit columns back at the end of every table (AGENTS.md: createdBy, createdAt, modifiedBy,
-- modifiedAt, isDeleted last). Columns added to tables that had data went after them (like Role.isSystem); Postgres
-- can't move a column, so each audit column is added again at the end, filled from the old one, and the old one dropped.
-- Nothing else depends on these columns but the createdBy / modifiedBy foreign keys, which are dropped and made again.
-- No row changes. Then every table is rewritten in primary-key order (CLUSTER), so rows read back in id order.

-- Setting
ALTER TABLE "Setting" DROP CONSTRAINT "Setting_createdBy_fkey", DROP CONSTRAINT "Setting_modifiedBy_fkey";
ALTER TABLE "Setting" RENAME COLUMN "createdBy" TO "_old_createdBy";
ALTER TABLE "Setting" RENAME COLUMN "createdAt" TO "_old_createdAt";
ALTER TABLE "Setting" RENAME COLUMN "modifiedBy" TO "_old_modifiedBy";
ALTER TABLE "Setting" RENAME COLUMN "modifiedAt" TO "_old_modifiedAt";
ALTER TABLE "Setting" RENAME COLUMN "isDeleted" TO "_old_isDeleted";
ALTER TABLE "Setting" ADD COLUMN "createdBy" TEXT, ADD COLUMN "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, ADD COLUMN "modifiedBy" TEXT, ADD COLUMN "modifiedAt" TIMESTAMPTZ(3), ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Setting" SET "createdBy" = "_old_createdBy", "createdAt" = "_old_createdAt", "modifiedBy" = "_old_modifiedBy", "modifiedAt" = "_old_modifiedAt", "isDeleted" = "_old_isDeleted";
ALTER TABLE "Setting" DROP COLUMN "_old_createdBy", DROP COLUMN "_old_createdAt", DROP COLUMN "_old_modifiedBy", DROP COLUMN "_old_modifiedAt", DROP COLUMN "_old_isDeleted";
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Role
ALTER TABLE "Role" DROP CONSTRAINT "Role_createdBy_fkey", DROP CONSTRAINT "Role_modifiedBy_fkey";
ALTER TABLE "Role" RENAME COLUMN "createdBy" TO "_old_createdBy";
ALTER TABLE "Role" RENAME COLUMN "createdAt" TO "_old_createdAt";
ALTER TABLE "Role" RENAME COLUMN "modifiedBy" TO "_old_modifiedBy";
ALTER TABLE "Role" RENAME COLUMN "modifiedAt" TO "_old_modifiedAt";
ALTER TABLE "Role" RENAME COLUMN "isDeleted" TO "_old_isDeleted";
ALTER TABLE "Role" ADD COLUMN "createdBy" TEXT, ADD COLUMN "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, ADD COLUMN "modifiedBy" TEXT, ADD COLUMN "modifiedAt" TIMESTAMPTZ(3), ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Role" SET "createdBy" = "_old_createdBy", "createdAt" = "_old_createdAt", "modifiedBy" = "_old_modifiedBy", "modifiedAt" = "_old_modifiedAt", "isDeleted" = "_old_isDeleted";
ALTER TABLE "Role" DROP COLUMN "_old_createdBy", DROP COLUMN "_old_createdAt", DROP COLUMN "_old_modifiedBy", DROP COLUMN "_old_modifiedAt", DROP COLUMN "_old_isDeleted";
ALTER TABLE "Role" ADD CONSTRAINT "Role_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Role" ADD CONSTRAINT "Role_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Customer
ALTER TABLE "Customer" DROP CONSTRAINT "Customer_createdBy_fkey", DROP CONSTRAINT "Customer_modifiedBy_fkey";
ALTER TABLE "Customer" RENAME COLUMN "createdBy" TO "_old_createdBy";
ALTER TABLE "Customer" RENAME COLUMN "createdAt" TO "_old_createdAt";
ALTER TABLE "Customer" RENAME COLUMN "modifiedBy" TO "_old_modifiedBy";
ALTER TABLE "Customer" RENAME COLUMN "modifiedAt" TO "_old_modifiedAt";
ALTER TABLE "Customer" RENAME COLUMN "isDeleted" TO "_old_isDeleted";
ALTER TABLE "Customer" ADD COLUMN "createdBy" TEXT, ADD COLUMN "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, ADD COLUMN "modifiedBy" TEXT, ADD COLUMN "modifiedAt" TIMESTAMPTZ(3), ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Customer" SET "createdBy" = "_old_createdBy", "createdAt" = "_old_createdAt", "modifiedBy" = "_old_modifiedBy", "modifiedAt" = "_old_modifiedAt", "isDeleted" = "_old_isDeleted";
ALTER TABLE "Customer" DROP COLUMN "_old_createdBy", DROP COLUMN "_old_createdAt", DROP COLUMN "_old_modifiedBy", DROP COLUMN "_old_modifiedAt", DROP COLUMN "_old_isDeleted";
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Product
ALTER TABLE "Product" DROP CONSTRAINT "Product_createdBy_fkey", DROP CONSTRAINT "Product_modifiedBy_fkey";
ALTER TABLE "Product" RENAME COLUMN "createdBy" TO "_old_createdBy";
ALTER TABLE "Product" RENAME COLUMN "createdAt" TO "_old_createdAt";
ALTER TABLE "Product" RENAME COLUMN "modifiedBy" TO "_old_modifiedBy";
ALTER TABLE "Product" RENAME COLUMN "modifiedAt" TO "_old_modifiedAt";
ALTER TABLE "Product" RENAME COLUMN "isDeleted" TO "_old_isDeleted";
ALTER TABLE "Product" ADD COLUMN "createdBy" TEXT, ADD COLUMN "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, ADD COLUMN "modifiedBy" TEXT, ADD COLUMN "modifiedAt" TIMESTAMPTZ(3), ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Product" SET "createdBy" = "_old_createdBy", "createdAt" = "_old_createdAt", "modifiedBy" = "_old_modifiedBy", "modifiedAt" = "_old_modifiedAt", "isDeleted" = "_old_isDeleted";
ALTER TABLE "Product" DROP COLUMN "_old_createdBy", DROP COLUMN "_old_createdAt", DROP COLUMN "_old_modifiedBy", DROP COLUMN "_old_modifiedAt", DROP COLUMN "_old_isDeleted";
ALTER TABLE "Product" ADD CONSTRAINT "Product_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Quotation
ALTER TABLE "Quotation" DROP CONSTRAINT "Quotation_createdBy_fkey", DROP CONSTRAINT "Quotation_modifiedBy_fkey";
ALTER TABLE "Quotation" RENAME COLUMN "createdBy" TO "_old_createdBy";
ALTER TABLE "Quotation" RENAME COLUMN "createdAt" TO "_old_createdAt";
ALTER TABLE "Quotation" RENAME COLUMN "modifiedBy" TO "_old_modifiedBy";
ALTER TABLE "Quotation" RENAME COLUMN "modifiedAt" TO "_old_modifiedAt";
ALTER TABLE "Quotation" RENAME COLUMN "isDeleted" TO "_old_isDeleted";
ALTER TABLE "Quotation" ADD COLUMN "createdBy" TEXT, ADD COLUMN "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, ADD COLUMN "modifiedBy" TEXT, ADD COLUMN "modifiedAt" TIMESTAMPTZ(3), ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Quotation" SET "createdBy" = "_old_createdBy", "createdAt" = "_old_createdAt", "modifiedBy" = "_old_modifiedBy", "modifiedAt" = "_old_modifiedAt", "isDeleted" = "_old_isDeleted";
ALTER TABLE "Quotation" DROP COLUMN "_old_createdBy", DROP COLUMN "_old_createdAt", DROP COLUMN "_old_modifiedBy", DROP COLUMN "_old_modifiedAt", DROP COLUMN "_old_isDeleted";
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Invoice
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

-- InvoiceItem
ALTER TABLE "InvoiceItem" DROP CONSTRAINT "InvoiceItem_createdBy_fkey", DROP CONSTRAINT "InvoiceItem_modifiedBy_fkey";
ALTER TABLE "InvoiceItem" RENAME COLUMN "createdBy" TO "_old_createdBy";
ALTER TABLE "InvoiceItem" RENAME COLUMN "createdAt" TO "_old_createdAt";
ALTER TABLE "InvoiceItem" RENAME COLUMN "modifiedBy" TO "_old_modifiedBy";
ALTER TABLE "InvoiceItem" RENAME COLUMN "modifiedAt" TO "_old_modifiedAt";
ALTER TABLE "InvoiceItem" RENAME COLUMN "isDeleted" TO "_old_isDeleted";
ALTER TABLE "InvoiceItem" ADD COLUMN "createdBy" TEXT, ADD COLUMN "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, ADD COLUMN "modifiedBy" TEXT, ADD COLUMN "modifiedAt" TIMESTAMPTZ(3), ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false;
UPDATE "InvoiceItem" SET "createdBy" = "_old_createdBy", "createdAt" = "_old_createdAt", "modifiedBy" = "_old_modifiedBy", "modifiedAt" = "_old_modifiedAt", "isDeleted" = "_old_isDeleted";
ALTER TABLE "InvoiceItem" DROP COLUMN "_old_createdBy", DROP COLUMN "_old_createdAt", DROP COLUMN "_old_modifiedBy", DROP COLUMN "_old_modifiedAt", DROP COLUMN "_old_isDeleted";
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- NumberSequence
ALTER TABLE "NumberSequence" RENAME COLUMN "createdBy" TO "_old_createdBy";
ALTER TABLE "NumberSequence" RENAME COLUMN "createdAt" TO "_old_createdAt";
ALTER TABLE "NumberSequence" RENAME COLUMN "modifiedBy" TO "_old_modifiedBy";
ALTER TABLE "NumberSequence" RENAME COLUMN "modifiedAt" TO "_old_modifiedAt";
ALTER TABLE "NumberSequence" RENAME COLUMN "isDeleted" TO "_old_isDeleted";
ALTER TABLE "NumberSequence" ADD COLUMN "createdBy" TEXT, ADD COLUMN "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, ADD COLUMN "modifiedBy" TEXT, ADD COLUMN "modifiedAt" TIMESTAMPTZ(3), ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false;
UPDATE "NumberSequence" SET "createdBy" = "_old_createdBy", "createdAt" = "_old_createdAt", "modifiedBy" = "_old_modifiedBy", "modifiedAt" = "_old_modifiedAt", "isDeleted" = "_old_isDeleted";
ALTER TABLE "NumberSequence" DROP COLUMN "_old_createdBy", DROP COLUMN "_old_createdAt", DROP COLUMN "_old_modifiedBy", DROP COLUMN "_old_modifiedAt", DROP COLUMN "_old_isDeleted";

-- Every table with a primary key (not Prisma's own), rewritten in that key's order.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT t.relname AS tbl, i.relname AS idx
    FROM pg_index x
    JOIN pg_class t ON t.oid = x.indrelid
    JOIN pg_class i ON i.oid = x.indexrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE x.indisprimary AND n.nspname = current_schema() AND t.relname <> '_prisma_migrations'
  LOOP
    EXECUTE format('CLUSTER %I USING %I', r.tbl, r.idx);
  END LOOP;
END $$;
