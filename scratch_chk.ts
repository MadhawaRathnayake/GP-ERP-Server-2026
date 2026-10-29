import { db } from "#core/db.js"
const cols = await db.$queryRaw<{ t: string; c: string }[]>`SELECT table_name t, string_agg(column_name, ',' ORDER BY ordinal_position) c FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('Product','Category','PriceMovement','CostMovement','StockMovement') GROUP BY table_name`
for (const r of cols) console.log(r.t, "→", r.c.split(",").slice(-5).join(","))
console.log(await db.$queryRaw`SELECT tgname FROM pg_trigger WHERE tgname LIKE '%notify_change' ORDER BY 1`)
console.log(await db.$queryRaw`SELECT (SELECT count(*) FROM "Product")::int products, (SELECT count(*) FROM "Customer")::int customers, (SELECT string_agg(name, ',') FROM "Role") roles`)
await db.$disconnect()
