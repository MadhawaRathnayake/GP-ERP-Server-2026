-- hand-written: Customer is recreated instead of altered, because ALTER TABLE ADD COLUMN puts new columns after the
-- audit columns, which must stay last. Stops here rather than lose data if the table is no longer empty. Dropping it
-- also drops its notify_change trigger, so the trigger is created again below. next_customer_id() and the CustomerType
-- enum stay as they are.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Customer") THEN
    RAISE EXCEPTION 'Customer has rows: this migration recreates the table and would lose them';
  END IF;
END $$;

DROP TABLE "Customer";

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL DEFAULT next_customer_id(),
    "code" TEXT NOT NULL,
    "type" "CustomerType" NOT NULL,
    "title" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phones" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "houseNumber" TEXT,
    "street" TEXT,
    "city" TEXT,
    "district" TEXT,
    "province" TEXT,
    "country" TEXT NOT NULL,
    "contactPerson" TEXT,
    "contactPhones" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "vatNumber" TEXT,
    "tinNumber" TEXT,
    "pvNumber" TEXT,
    "isCommissioned" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDormant" BOOLEAN NOT NULL DEFAULT false,
    "lastInvoiceDate" TIMESTAMPTZ(3),
    "totalInvoices" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedBy" TEXT,
    "modifiedAt" TIMESTAMPTZ(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Customer_id_idx" ON "Customer"("id");

-- CreateIndex
CREATE INDEX "Customer_code_idx" ON "Customer"("code");

-- CreateIndex
CREATE INDEX "Customer_name_idx" ON "Customer"("name");

-- CreateIndex
CREATE INDEX "Customer_city_idx" ON "Customer"("city");

-- CreateIndex
CREATE INDEX "Customer_district_idx" ON "Customer"("district");

-- CreateIndex
CREATE INDEX "Customer_phones_idx" ON "Customer" USING GIN ("phones");

-- CreateIndex
CREATE INDEX "Customer_vatNumber_idx" ON "Customer"("vatNumber");

-- CreateIndex
CREATE INDEX "Customer_tinNumber_idx" ON "Customer"("tinNumber");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Cache invalidation: notify platform/cache/db-events.plugin.ts on any write to "Customer" (added by scripts/migrate.ts)
CREATE TRIGGER "Customer_notify_change"
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "Customer"
FOR EACH STATEMENT EXECUTE FUNCTION notify_change();
