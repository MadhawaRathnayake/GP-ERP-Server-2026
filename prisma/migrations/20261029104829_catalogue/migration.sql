/*
  Warnings:

  - The primary key for the `Product` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `cost` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `price` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `stock` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `stockSold` on the `Product` table. All the data in the column will be lost.
  - Added the required column `categoryId` to the `Product` table without a default value. This is not possible if the table is not empty.
  - Added the required column `title` to the `Product` table without a default value. This is not possible if the table is not empty.
  - Added the required column `trackingType` to the `Product` table without a default value. This is not possible if the table is not empty.
  - Added the required column `warrantyMonths` to the `Product` table without a default value. This is not possible if the table is not empty.

*/
-- hand-written: product / category id generators, same pattern as next_user_id() in the init migration.
-- PROD000001 … and CAT0001 …; they widen instead of truncating, and numbers are never reused.
CREATE SEQUENCE "product_number_seq" AS bigint;

CREATE FUNCTION next_product_id() RETURNS text LANGUAGE sql AS $$
  SELECT 'PROD' || lpad(n::text, greatest(6, length(n::text)), '0') FROM nextval('product_number_seq') AS n
$$;

CREATE SEQUENCE "category_number_seq" AS bigint;

CREATE FUNCTION next_category_id() RETURNS text LANGUAGE sql AS $$
  SELECT 'CAT' || lpad(n::text, greatest(4, length(n::text)), '0') FROM nextval('category_number_seq') AS n
$$;

-- CreateEnum
CREATE TYPE "TrackingType" AS ENUM ('quantity', 'serial');

-- CreateEnum
CREATE TYPE "StockBucket" AS ENUM ('inHand', 'preOrder', 'inTransit', 'onArrival');

-- hand-written: Product is recreated instead of altered (it was emptied first), because ALTER TABLE ADD COLUMN puts
-- new columns after the audit columns, which must stay last. Dropping it also drops its notify_change trigger,
-- so the trigger is created again below.
DROP TABLE "Product";

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL DEFAULT next_product_id(),
    "sku" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT 'N/A',
    "categoryId" TEXT NOT NULL,
    "manufacturer" TEXT,
    "countryOfOrigin" TEXT,
    "imageUrl" TEXT,
    "documentUrl" TEXT,
    "slug" TEXT,
    "warrantyMonths" INTEGER NOT NULL,
    "minimumStock" INTEGER NOT NULL DEFAULT 0,
    "stockInHand" INTEGER NOT NULL DEFAULT 0,
    "stockPreOrder" INTEGER NOT NULL DEFAULT 0,
    "stockInTransit" INTEGER NOT NULL DEFAULT 0,
    "stockOnArrival" INTEGER NOT NULL DEFAULT 0,
    "additionalInfo" JSONB,
    "trackingType" "TrackingType" NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedBy" TEXT,
    "modifiedAt" TIMESTAMPTZ(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- DropEnum
DROP TYPE "ProductStatus";

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL DEFAULT next_category_id(),
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedBy" TEXT,
    "modifiedAt" TIMESTAMPTZ(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceMovement" (
    "id" SERIAL NOT NULL,
    "productId" TEXT NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,
    "remarks" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedBy" TEXT,
    "modifiedAt" TIMESTAMPTZ(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PriceMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostMovement" (
    "id" SERIAL NOT NULL,
    "productId" TEXT NOT NULL,
    "cost" DECIMAL(14,2) NOT NULL,
    "remarks" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedBy" TEXT,
    "modifiedAt" TIMESTAMPTZ(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CostMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" SERIAL NOT NULL,
    "productId" TEXT NOT NULL,
    "bucket" "StockBucket" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "serialNumber" TEXT,
    "reference" TEXT,
    "remarks" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedBy" TEXT,
    "modifiedAt" TIMESTAMPTZ(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE INDEX "PriceMovement_productId_createdAt_idx" ON "PriceMovement"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "CostMovement_productId_createdAt_idx" ON "CostMovement"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_productId_createdAt_idx" ON "StockMovement"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_serialNumber_idx" ON "StockMovement"("serialNumber");

-- CreateIndex
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceMovement" ADD CONSTRAINT "PriceMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceMovement" ADD CONSTRAINT "PriceMovement_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceMovement" ADD CONSTRAINT "PriceMovement_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostMovement" ADD CONSTRAINT "CostMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostMovement" ADD CONSTRAINT "CostMovement_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostMovement" ADD CONSTRAINT "CostMovement_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Cache invalidation: notify platform/cache/db-events.plugin.ts on any write to "Product" (added by scripts/migrate.ts)
CREATE TRIGGER "Product_notify_change"
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "Product"
FOR EACH STATEMENT EXECUTE FUNCTION notify_change();

-- Cache invalidation: notify platform/cache/db-events.plugin.ts on any write to "Category" (added by scripts/migrate.ts)
CREATE TRIGGER "Category_notify_change"
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "Category"
FOR EACH STATEMENT EXECUTE FUNCTION notify_change();

-- Cache invalidation: notify platform/cache/db-events.plugin.ts on any write to "PriceMovement" (added by scripts/migrate.ts)
CREATE TRIGGER "PriceMovement_notify_change"
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "PriceMovement"
FOR EACH STATEMENT EXECUTE FUNCTION notify_change();

-- Cache invalidation: notify platform/cache/db-events.plugin.ts on any write to "CostMovement" (added by scripts/migrate.ts)
CREATE TRIGGER "CostMovement_notify_change"
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "CostMovement"
FOR EACH STATEMENT EXECUTE FUNCTION notify_change();

-- Cache invalidation: notify platform/cache/db-events.plugin.ts on any write to "StockMovement" (added by scripts/migrate.ts)
CREATE TRIGGER "StockMovement_notify_change"
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "StockMovement"
FOR EACH STATEMENT EXECUTE FUNCTION notify_change();
