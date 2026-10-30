-- hand-written: Product gets current price/cost, additionalInfo becomes TEXT, and the movement tables get the
-- previous value. The three tables were empty, so they are recreated instead of altered: ALTER TABLE ADD COLUMN would
-- put the new columns after the audit columns, which must stay last. DROP ... CASCADE also removes the
-- StockMovement → Product foreign key and the tables' notify_change triggers; both are created again below.
DROP TABLE "PriceMovement";
DROP TABLE "CostMovement";
DROP TABLE "Product" CASCADE;

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
    "price" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "minimumStock" INTEGER NOT NULL DEFAULT 0,
    "stockInHand" INTEGER NOT NULL DEFAULT 0,
    "stockPreOrder" INTEGER NOT NULL DEFAULT 0,
    "stockInTransit" INTEGER NOT NULL DEFAULT 0,
    "stockOnArrival" INTEGER NOT NULL DEFAULT 0,
    "additionalInfo" TEXT,
    "trackingType" "TrackingType" NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedBy" TEXT,
    "modifiedAt" TIMESTAMPTZ(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceMovement" (
    "id" SERIAL NOT NULL,
    "productId" TEXT NOT NULL,
    "previousPrice" DECIMAL(14,2),
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
    "previousCost" DECIMAL(14,2),
    "cost" DECIMAL(14,2) NOT NULL,
    "remarks" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedBy" TEXT,
    "modifiedAt" TIMESTAMPTZ(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CostMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- CreateIndex
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");

-- CreateIndex
CREATE INDEX "PriceMovement_productId_createdAt_idx" ON "PriceMovement"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "CostMovement_productId_createdAt_idx" ON "CostMovement"("productId", "createdAt");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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

-- Cache invalidation: notify platform/cache/db-events.plugin.ts on any write to "Product" (added by scripts/migrate.ts)
CREATE TRIGGER "Product_notify_change"
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "Product"
FOR EACH STATEMENT EXECUTE FUNCTION notify_change();

-- Cache invalidation: notify platform/cache/db-events.plugin.ts on any write to "PriceMovement" (added by scripts/migrate.ts)
CREATE TRIGGER "PriceMovement_notify_change"
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "PriceMovement"
FOR EACH STATEMENT EXECUTE FUNCTION notify_change();

-- Cache invalidation: notify platform/cache/db-events.plugin.ts on any write to "CostMovement" (added by scripts/migrate.ts)
CREATE TRIGGER "CostMovement_notify_change"
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "CostMovement"
FOR EACH STATEMENT EXECUTE FUNCTION notify_change();
