-- hand-written: one stock figure (docs/plans/serial-numbers.md §3.1). Product keeps only "stockInHand"; the old
-- system's pre-order, in-transit and on-arrival figures go, with StockMovement's "bucket" and its unused "serialNumber".

-- hand-written: the live-stock trigger names the dropped columns, so it goes first and comes back for "stockInHand"
-- only (migration 20261105090000_product_stock_version).
DROP TRIGGER "Product_set_stock_version" ON "Product";

-- hand-written: the movements of the dropped buckets (in transit, imported from the old system) go with them. The
-- "inHand" rows stay, so the in-hand history doesn't change.
DELETE FROM "StockMovement" WHERE "bucket" <> 'inHand';

-- DropIndex
DROP INDEX "StockMovement_serialNumber_idx";

-- AlterTable
ALTER TABLE "StockMovement" DROP COLUMN "bucket",
DROP COLUMN "serialNumber";

-- DropEnum
DROP TYPE "StockBucket";

-- AlterTable
ALTER TABLE "Product" DROP COLUMN "stockInTransit",
DROP COLUMN "stockOnArrival",
DROP COLUMN "stockPreOrder";

-- hand-written: stamps the next version whenever "stockInHand" changes (set_stock_version() is unchanged).
CREATE TRIGGER "Product_set_stock_version"
BEFORE UPDATE OF "stockInHand" ON "Product"
FOR EACH ROW
WHEN (OLD."stockInHand" IS DISTINCT FROM NEW."stockInHand")
EXECUTE FUNCTION set_stock_version();

-- hand-written: the stock_change payload without the dropped columns (modules/stock/stock.schema.ts). The trigger
-- "Product_notify_stock_change" fires on the version and stays as it is.
CREATE OR REPLACE FUNCTION notify_stock_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('stock_change', json_build_object(
    'id', NEW."id",
    'stockInHand', NEW."stockInHand",
    'stockVersion', NEW."stockVersion"
  )::text);
  RETURN NULL;
END;
$$;
