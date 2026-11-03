-- hand-written: supplier id generator, same pattern as next_user_id() in the init migration.
-- SUP0001 …; it widens instead of truncating, and numbers are never reused.
CREATE SEQUENCE "supplier_number_seq" AS bigint;

CREATE FUNCTION next_supplier_id() RETURNS text LANGUAGE sql AS $$
  SELECT 'SUP' || lpad(n::text, greatest(5, length(n::text)), '0') FROM nextval('supplier_number_seq') AS n
$$;

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL DEFAULT next_supplier_id(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phones" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "email" TEXT,
    "houseNumber" TEXT,
    "street" TEXT,
    "city" TEXT,
    "district" TEXT,
    "province" TEXT,
    "country" TEXT NOT NULL,
    "vatNumber" TEXT,
    "tinNumber" TEXT,
    "pvNumber" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedBy" TEXT,
    "modifiedAt" TIMESTAMPTZ(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Supplier_id_idx" ON "Supplier"("id");

-- CreateIndex
CREATE INDEX "Supplier_name_idx" ON "Supplier"("name");

-- CreateIndex
CREATE INDEX "Supplier_code_idx" ON "Supplier"("code");

-- CreateIndex
CREATE INDEX "Supplier_phones_idx" ON "Supplier" USING GIN ("phones");

-- CreateIndex
CREATE INDEX "Supplier_vatNumber_idx" ON "Supplier"("vatNumber");

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Cache invalidation: notify platform/cache/db-events.plugin.ts on any write to "Supplier" (added by scripts/migrate.ts)
CREATE TRIGGER "Supplier_notify_change"
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "Supplier"
FOR EACH STATEMENT EXECUTE FUNCTION notify_change();
