-- hand-written: serial numbers, step 2 (docs/plans/serial-numbers.md §3.9, §4): units of serial-tracked products,
-- their history, and the accessories that come with them.

-- hand-written: ACC0001, ACC0002, … (like next_category_id()), before the table whose default calls it.
CREATE SEQUENCE "accessory_number_seq" AS bigint;

CREATE FUNCTION next_accessory_id() RETURNS text LANGUAGE sql AS $$
  SELECT 'ACC' || lpad(n::text, greatest(4, length(n::text)), '0') FROM nextval('accessory_number_seq') AS n
$$;

-- CreateEnum
CREATE TYPE "SerialItemStatus" AS ENUM ('inStock', 'sold', 'removed');

-- CreateTable
CREATE TABLE "SerialItem" (
    "id" SERIAL NOT NULL,
    "productId" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "palletNumber" TEXT,
    "status" "SerialItemStatus" NOT NULL DEFAULT 'inStock',
    "goodsReceivedNoteDeliveryId" INTEGER,
    "invoiceId" INTEGER,
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedBy" TEXT,
    "modifiedAt" TIMESTAMPTZ(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SerialItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SerialItemMovement" (
    "id" SERIAL NOT NULL,
    "serialItemId" INTEGER NOT NULL,
    "fromStatus" "SerialItemStatus",
    "toStatus" "SerialItemStatus" NOT NULL,
    "goodsReceivedNoteDeliveryId" INTEGER,
    "invoiceId" INTEGER,
    "remarks" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedBy" TEXT,
    "modifiedAt" TIMESTAMPTZ(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SerialItemMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Accessory" (
    "id" TEXT NOT NULL DEFAULT next_accessory_id(),
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "productId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedBy" TEXT,
    "modifiedAt" TIMESTAMPTZ(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Accessory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductAccessory" (
    "id" SERIAL NOT NULL,
    "productId" TEXT NOT NULL,
    "accessoryId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedBy" TEXT,
    "modifiedAt" TIMESTAMPTZ(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ProductAccessory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SerialItemAccessory" (
    "id" SERIAL NOT NULL,
    "serialItemId" INTEGER NOT NULL,
    "accessoryId" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedBy" TEXT,
    "modifiedAt" TIMESTAMPTZ(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SerialItemAccessory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SerialItem_productId_status_idx" ON "SerialItem"("productId", "status");

-- CreateIndex
CREATE INDEX "SerialItem_palletNumber_idx" ON "SerialItem"("palletNumber");

-- CreateIndex
CREATE INDEX "SerialItem_goodsReceivedNoteDeliveryId_idx" ON "SerialItem"("goodsReceivedNoteDeliveryId");

-- CreateIndex
CREATE INDEX "SerialItem_invoiceId_idx" ON "SerialItem"("invoiceId");

-- CreateIndex
CREATE INDEX "SerialItemMovement_serialItemId_createdAt_idx" ON "SerialItemMovement"("serialItemId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Accessory_name_key" ON "Accessory"("name");

-- CreateIndex
CREATE INDEX "ProductAccessory_productId_idx" ON "ProductAccessory"("productId");

-- CreateIndex
CREATE INDEX "ProductAccessory_accessoryId_idx" ON "ProductAccessory"("accessoryId");

-- CreateIndex
CREATE INDEX "SerialItemAccessory_serialItemId_idx" ON "SerialItemAccessory"("serialItemId");

-- CreateIndex
CREATE INDEX "SerialItemAccessory_accessoryId_idx" ON "SerialItemAccessory"("accessoryId");

-- AddForeignKey
ALTER TABLE "SerialItem" ADD CONSTRAINT "SerialItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SerialItem" ADD CONSTRAINT "SerialItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SerialItem" ADD CONSTRAINT "SerialItem_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SerialItem" ADD CONSTRAINT "SerialItem_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SerialItemMovement" ADD CONSTRAINT "SerialItemMovement_serialItemId_fkey" FOREIGN KEY ("serialItemId") REFERENCES "SerialItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SerialItemMovement" ADD CONSTRAINT "SerialItemMovement_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SerialItemMovement" ADD CONSTRAINT "SerialItemMovement_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SerialItemMovement" ADD CONSTRAINT "SerialItemMovement_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Accessory" ADD CONSTRAINT "Accessory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Accessory" ADD CONSTRAINT "Accessory_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Accessory" ADD CONSTRAINT "Accessory_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAccessory" ADD CONSTRAINT "ProductAccessory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAccessory" ADD CONSTRAINT "ProductAccessory_accessoryId_fkey" FOREIGN KEY ("accessoryId") REFERENCES "Accessory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAccessory" ADD CONSTRAINT "ProductAccessory_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAccessory" ADD CONSTRAINT "ProductAccessory_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SerialItemAccessory" ADD CONSTRAINT "SerialItemAccessory_serialItemId_fkey" FOREIGN KEY ("serialItemId") REFERENCES "SerialItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SerialItemAccessory" ADD CONSTRAINT "SerialItemAccessory_accessoryId_fkey" FOREIGN KEY ("accessoryId") REFERENCES "Accessory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SerialItemAccessory" ADD CONSTRAINT "SerialItemAccessory_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SerialItemAccessory" ADD CONSTRAINT "SerialItemAccessory_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- hand-written: a serial number identifies one unit across all products, ignoring case; it is stored as typed.
CREATE UNIQUE INDEX "SerialItem_serialNumber_key" ON "SerialItem"(upper("serialNumber")) WHERE NOT "isDeleted";

-- hand-written: the same for accessory serials.
CREATE UNIQUE INDEX "SerialItemAccessory_serialNumber_key" ON "SerialItemAccessory"(upper("serialNumber")) WHERE NOT "isDeleted";

-- hand-written: a product lists an accessory once (saving its list soft-deletes the old rows).
CREATE UNIQUE INDEX "ProductAccessory_product_accessory_key" ON "ProductAccessory"("productId", "accessoryId") WHERE NOT "isDeleted";

-- hand-written: a sold unit is on an invoice, and only a sold one.
ALTER TABLE "SerialItem" ADD CONSTRAINT "SerialItem_invoice_check" CHECK (("status" = 'sold') = ("invoiceId" IS NOT NULL));

-- hand-written: serials aren't blank, and a product needs at least one of an accessory.
ALTER TABLE "SerialItem" ADD CONSTRAINT "SerialItem_serialNumber_check" CHECK (btrim("serialNumber") <> '');
ALTER TABLE "SerialItemAccessory" ADD CONSTRAINT "SerialItemAccessory_serialNumber_check" CHECK (btrim("serialNumber") <> '');
ALTER TABLE "ProductAccessory" ADD CONSTRAINT "ProductAccessory_quantity_check" CHECK ("quantity" >= 1);

-- Cache invalidation: notify platform/cache/db-events.plugin.ts on any write to "SerialItem" (added by scripts/migrate.ts)
CREATE TRIGGER "SerialItem_notify_change"
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "SerialItem"
FOR EACH STATEMENT EXECUTE FUNCTION notify_change();

-- Cache invalidation: notify platform/cache/db-events.plugin.ts on any write to "SerialItemMovement" (added by scripts/migrate.ts)
CREATE TRIGGER "SerialItemMovement_notify_change"
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "SerialItemMovement"
FOR EACH STATEMENT EXECUTE FUNCTION notify_change();

-- Cache invalidation: notify platform/cache/db-events.plugin.ts on any write to "Accessory" (added by scripts/migrate.ts)
CREATE TRIGGER "Accessory_notify_change"
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "Accessory"
FOR EACH STATEMENT EXECUTE FUNCTION notify_change();

-- Cache invalidation: notify platform/cache/db-events.plugin.ts on any write to "ProductAccessory" (added by scripts/migrate.ts)
CREATE TRIGGER "ProductAccessory_notify_change"
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "ProductAccessory"
FOR EACH STATEMENT EXECUTE FUNCTION notify_change();

-- Cache invalidation: notify platform/cache/db-events.plugin.ts on any write to "SerialItemAccessory" (added by scripts/migrate.ts)
CREATE TRIGGER "SerialItemAccessory_notify_change"
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "SerialItemAccessory"
FOR EACH STATEMENT EXECUTE FUNCTION notify_change();
