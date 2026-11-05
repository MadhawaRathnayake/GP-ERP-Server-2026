-- hand-written: live stock (modules/stock). See Product.stockVersion in schema.prisma.
-- Product holds data, so the column is added rather than the table recreated: in the database it sits after the audit
-- columns, like Role.isSystem. Nothing reads columns by position, and schema.prisma keeps the audit columns last.
ALTER TABLE "Product" ADD COLUMN "stockVersion" BIGINT NOT NULL DEFAULT 0;

-- hand-written: one counter for every product, so a higher stockVersion is always the later stock change.
CREATE SEQUENCE "stock_version_seq" AS bigint;

-- hand-written: stamps the next version whenever a stock column changes, whoever writes it (the app, SQL, psql).
-- BEFORE, so the version is part of the written row and of what UPDATE … RETURNING (Prisma) sends back.
CREATE FUNCTION set_stock_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."stockVersion" := nextval('stock_version_seq');
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Product_set_stock_version"
BEFORE UPDATE OF "stockInHand", "stockPreOrder", "stockInTransit", "stockOnArrival" ON "Product"
FOR EACH ROW
WHEN ((OLD."stockInHand", OLD."stockPreOrder", OLD."stockInTransit", OLD."stockOnArrival")
  IS DISTINCT FROM (NEW."stockInHand", NEW."stockPreOrder", NEW."stockInTransit", NEW."stockOnArrival"))
EXECUTE FUNCTION set_stock_version();

-- hand-written: sends the product's new stock on channel stock_change (modules/stock/stock.events.ts). Postgres
-- delivers it only when the transaction commits, so a rolled-back change is never announced. It isn't stored: a
-- listener that is disconnected at that moment misses it, and clients then reload GET /api/v1/stock.
-- Fires on the version, not the stock columns: a BEFORE trigger's change doesn't count for UPDATE OF.
CREATE FUNCTION notify_stock_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('stock_change', json_build_object(
    'id', NEW."id",
    'stockInHand', NEW."stockInHand",
    'stockPreOrder', NEW."stockPreOrder",
    'stockInTransit', NEW."stockInTransit",
    'stockOnArrival', NEW."stockOnArrival",
    'stockVersion', NEW."stockVersion"
  )::text);
  RETURN NULL;
END;
$$;

CREATE TRIGGER "Product_notify_stock_change"
AFTER UPDATE ON "Product"
FOR EACH ROW
WHEN (OLD."stockVersion" IS DISTINCT FROM NEW."stockVersion")
EXECUTE FUNCTION notify_stock_change();
