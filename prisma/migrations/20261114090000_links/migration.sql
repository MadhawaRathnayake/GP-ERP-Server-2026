-- hand-written: ids where rows pointed at each other by value only.
--   1. GoodsReceivedNoteDeliveryItem.goodsReceivedNoteItemId: the GRN line a delivery item adds to (was matched by
--      product). A product is on one line of a GRN (partial unique index), so each existing item has exactly one line.
--   2. StockMovement.invoiceId / goodsReceivedNoteId: the document that moved the stock (was only its number in
--      `reference`, which stays as the printed number). At most one is set; both NULL = adjustment or import.
--   3. NumberSequence.createdBy / modifiedBy get their foreign keys to User, like every other table.
--   4. UserDropdown.userIds / roleIds (text arrays) become the link tables UserDropdownUser / UserDropdownRole.
-- The new columns are added at the end, then the audit columns are moved back after them, as in
-- 20261113090000_audit_columns_last. No other row changes.

-- 1. GRN delivery items → their GRN line
CREATE UNIQUE INDEX "GoodsReceivedNoteItem_product_key" ON "GoodsReceivedNoteItem"("goodsReceivedNoteId", "productId") WHERE NOT "isDeleted";

ALTER TABLE "GoodsReceivedNoteDeliveryItem" ADD COLUMN "goodsReceivedNoteItemId" INTEGER;
UPDATE "GoodsReceivedNoteDeliveryItem" di
SET "goodsReceivedNoteItemId" = gi.id
FROM "GoodsReceivedNoteDelivery" d, "GoodsReceivedNoteItem" gi
WHERE d.id = di."deliveryId" AND gi."goodsReceivedNoteId" = d."goodsReceivedNoteId" AND gi."productId" = di."productId" AND NOT gi."isDeleted";
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "GoodsReceivedNoteDeliveryItem" WHERE "goodsReceivedNoteItemId" IS NULL) THEN
    RAISE EXCEPTION 'GoodsReceivedNoteDeliveryItem rows without a GRN line of their product: %',
      (SELECT string_agg(id::text, ', ') FROM "GoodsReceivedNoteDeliveryItem" WHERE "goodsReceivedNoteItemId" IS NULL);
  END IF;
END $$;
ALTER TABLE "GoodsReceivedNoteDeliveryItem" ALTER COLUMN "goodsReceivedNoteItemId" SET NOT NULL;
ALTER TABLE "GoodsReceivedNoteDeliveryItem" ADD CONSTRAINT "GoodsReceivedNoteDeliveryItem_goodsReceivedNoteItemId_fkey" FOREIGN KEY ("goodsReceivedNoteItemId") REFERENCES "GoodsReceivedNoteItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "GoodsReceivedNoteDeliveryItem_goodsReceivedNoteItemId_idx" ON "GoodsReceivedNoteDeliveryItem"("goodsReceivedNoteItemId");

ALTER TABLE "GoodsReceivedNoteDeliveryItem" DROP CONSTRAINT "GoodsReceivedNoteDeliveryItem_createdBy_fkey", DROP CONSTRAINT "GoodsReceivedNoteDeliveryItem_modifiedBy_fkey";
ALTER TABLE "GoodsReceivedNoteDeliveryItem" RENAME COLUMN "createdBy" TO "_old_createdBy";
ALTER TABLE "GoodsReceivedNoteDeliveryItem" RENAME COLUMN "createdAt" TO "_old_createdAt";
ALTER TABLE "GoodsReceivedNoteDeliveryItem" RENAME COLUMN "modifiedBy" TO "_old_modifiedBy";
ALTER TABLE "GoodsReceivedNoteDeliveryItem" RENAME COLUMN "modifiedAt" TO "_old_modifiedAt";
ALTER TABLE "GoodsReceivedNoteDeliveryItem" RENAME COLUMN "isDeleted" TO "_old_isDeleted";
ALTER TABLE "GoodsReceivedNoteDeliveryItem" ADD COLUMN "createdBy" TEXT, ADD COLUMN "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, ADD COLUMN "modifiedBy" TEXT, ADD COLUMN "modifiedAt" TIMESTAMPTZ(3), ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false;
UPDATE "GoodsReceivedNoteDeliveryItem" SET "createdBy" = "_old_createdBy", "createdAt" = "_old_createdAt", "modifiedBy" = "_old_modifiedBy", "modifiedAt" = "_old_modifiedAt", "isDeleted" = "_old_isDeleted";
ALTER TABLE "GoodsReceivedNoteDeliveryItem" DROP COLUMN "_old_createdBy", DROP COLUMN "_old_createdAt", DROP COLUMN "_old_modifiedBy", DROP COLUMN "_old_modifiedAt", DROP COLUMN "_old_isDeleted";
ALTER TABLE "GoodsReceivedNoteDeliveryItem" ADD CONSTRAINT "GoodsReceivedNoteDeliveryItem_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GoodsReceivedNoteDeliveryItem" ADD CONSTRAINT "GoodsReceivedNoteDeliveryItem_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. Stock movements → their invoice or GRN
ALTER TABLE "StockMovement" ADD COLUMN "invoiceId" INTEGER, ADD COLUMN "goodsReceivedNoteId" INTEGER;
UPDATE "StockMovement" s SET "invoiceId" = i.id FROM "Invoice" i WHERE i."invoiceNumber" = s.reference;
UPDATE "StockMovement" s SET "goodsReceivedNoteId" = g.id FROM "GoodsReceivedNote" g WHERE g."grnNumber" = s.reference;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_source_check" CHECK (num_nonnulls("invoiceId", "goodsReceivedNoteId") <= 1);
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_goodsReceivedNoteId_fkey" FOREIGN KEY ("goodsReceivedNoteId") REFERENCES "GoodsReceivedNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "StockMovement_invoiceId_idx" ON "StockMovement"("invoiceId");
CREATE INDEX "StockMovement_goodsReceivedNoteId_idx" ON "StockMovement"("goodsReceivedNoteId");

ALTER TABLE "StockMovement" DROP CONSTRAINT "StockMovement_createdBy_fkey", DROP CONSTRAINT "StockMovement_modifiedBy_fkey";
ALTER TABLE "StockMovement" RENAME COLUMN "createdBy" TO "_old_createdBy";
ALTER TABLE "StockMovement" RENAME COLUMN "createdAt" TO "_old_createdAt";
ALTER TABLE "StockMovement" RENAME COLUMN "modifiedBy" TO "_old_modifiedBy";
ALTER TABLE "StockMovement" RENAME COLUMN "modifiedAt" TO "_old_modifiedAt";
ALTER TABLE "StockMovement" RENAME COLUMN "isDeleted" TO "_old_isDeleted";
ALTER TABLE "StockMovement" ADD COLUMN "createdBy" TEXT, ADD COLUMN "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, ADD COLUMN "modifiedBy" TEXT, ADD COLUMN "modifiedAt" TIMESTAMPTZ(3), ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false;
UPDATE "StockMovement" SET "createdBy" = "_old_createdBy", "createdAt" = "_old_createdAt", "modifiedBy" = "_old_modifiedBy", "modifiedAt" = "_old_modifiedAt", "isDeleted" = "_old_isDeleted";
ALTER TABLE "StockMovement" DROP COLUMN "_old_createdBy", DROP COLUMN "_old_createdAt", DROP COLUMN "_old_modifiedBy", DROP COLUMN "_old_modifiedAt", DROP COLUMN "_old_isDeleted";
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- The index on (productId, createdAt) went with the old createdAt column.
CREATE INDEX "StockMovement_productId_createdAt_idx" ON "StockMovement"("productId", "createdAt");

-- 3. NumberSequence audit foreign keys
ALTER TABLE "NumberSequence" ADD CONSTRAINT "NumberSequence_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NumberSequence" ADD CONSTRAINT "NumberSequence_modifiedBy_fkey" FOREIGN KEY ("modifiedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. User dropdown selections as link tables (no audit columns, like RolePermission)
CREATE TABLE "UserDropdownUser" (
    "dropdownId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "UserDropdownUser_pkey" PRIMARY KEY ("dropdownId","userId")
);
CREATE TABLE "UserDropdownRole" (
    "dropdownId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "UserDropdownRole_pkey" PRIMARY KEY ("dropdownId","roleId")
);
CREATE INDEX "UserDropdownUser_userId_idx" ON "UserDropdownUser"("userId");
CREATE INDEX "UserDropdownRole_roleId_idx" ON "UserDropdownRole"("roleId");
ALTER TABLE "UserDropdownUser" ADD CONSTRAINT "UserDropdownUser_dropdownId_fkey" FOREIGN KEY ("dropdownId") REFERENCES "UserDropdown"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserDropdownUser" ADD CONSTRAINT "UserDropdownUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserDropdownRole" ADD CONSTRAINT "UserDropdownRole_dropdownId_fkey" FOREIGN KEY ("dropdownId") REFERENCES "UserDropdown"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserDropdownRole" ADD CONSTRAINT "UserDropdownRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The saved selections; ids of users or roles that no longer exist are dropped.
INSERT INTO "UserDropdownUser" ("dropdownId", "userId")
SELECT DISTINCT d.id, u.id FROM "UserDropdown" d CROSS JOIN LATERAL unnest(d."userIds") AS picked(id) JOIN "User" u ON u.id = picked.id;
INSERT INTO "UserDropdownRole" ("dropdownId", "roleId")
SELECT DISTINCT d.id, r.id FROM "UserDropdown" d CROSS JOIN LATERAL unnest(d."roleIds") AS picked(id) JOIN "Role" r ON r.id = picked.id;
ALTER TABLE "UserDropdown" DROP COLUMN "userIds", DROP COLUMN "roleIds";

-- Cache invalidation: notify platform/cache/db-events.plugin.ts on any write to "UserDropdownUser"
CREATE TRIGGER "UserDropdownUser_notify_change"
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "UserDropdownUser"
FOR EACH STATEMENT EXECUTE FUNCTION notify_change();

-- Cache invalidation: notify platform/cache/db-events.plugin.ts on any write to "UserDropdownRole"
CREATE TRIGGER "UserDropdownRole_notify_change"
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON "UserDropdownRole"
FOR EACH STATEMENT EXECUTE FUNCTION notify_change();
