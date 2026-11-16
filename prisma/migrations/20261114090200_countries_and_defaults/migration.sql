-- hand-written:
--   1. Customer.country, Supplier.country and Setting.country hold the ISO 3166-1 alpha-3 code (LKA), CHAR(3), checked
--      by the API against modules/countries. The names in use are mapped here; it stops and lists any other value, so
--      add it to the list below and run again. Changing a column's type keeps its position.
--   2. Product.description: NULL instead of the placeholder 'N/A' (no default).

-- 1. Country codes. Setting.country is CHAR(2) until the end, so it is made TEXT first to take a 3-letter code.
ALTER TABLE "Setting" ALTER COLUMN "country" SET DATA TYPE TEXT;
CREATE TEMPORARY TABLE "_country" (name TEXT PRIMARY KEY, code CHAR(3) NOT NULL);
INSERT INTO "_country" VALUES
  ('sri lanka', 'LKA'), ('lk', 'LKA'), ('ireland', 'IRL'), ('china', 'CHN'), ('united arab emirates', 'ARE'),
  ('hong kong', 'HKG');

UPDATE "Customer" t SET country = c.code FROM "_country" c WHERE lower(trim(t.country)) = c.name;
UPDATE "Supplier" t SET country = c.code FROM "_country" c WHERE lower(trim(t.country)) = c.name;
UPDATE "Setting" t SET country = c.code FROM "_country" c WHERE lower(trim(t.country)) = c.name;

DO $$
DECLARE
  unknown TEXT;
BEGIN
  SELECT string_agg(DISTINCT country, ', ') INTO unknown FROM (
    SELECT country FROM "Customer" UNION ALL SELECT country FROM "Supplier" UNION ALL SELECT country FROM "Setting"
  ) used WHERE country !~ '^[A-Z]{3}$';
  IF unknown IS NOT NULL THEN
    RAISE EXCEPTION 'Countries without an alpha-3 code (add them to "_country" in this migration): %', unknown;
  END IF;
END $$;

DROP TABLE "_country";
ALTER TABLE "Customer" ALTER COLUMN "country" SET DATA TYPE CHAR(3);
ALTER TABLE "Supplier" ALTER COLUMN "country" SET DATA TYPE CHAR(3);
ALTER TABLE "Setting" ALTER COLUMN "country" SET DATA TYPE CHAR(3);

-- 2. Product description
ALTER TABLE "Product" ALTER COLUMN "description" DROP NOT NULL, ALTER COLUMN "description" DROP DEFAULT;
UPDATE "Product" SET description = NULL WHERE description = 'N/A';
