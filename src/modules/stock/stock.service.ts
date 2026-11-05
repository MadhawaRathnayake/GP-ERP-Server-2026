import { db } from "#core/db.js"

/** Current stock of every active product: what a client loads to catch up on changes it may have missed. */
export function listStockLevels() {
  return db.product.findMany({
    where: { isDeleted: false },
    select: { id: true, stockInHand: true, stockPreOrder: true, stockInTransit: true, stockOnArrival: true, stockVersion: true },
    orderBy: { id: "asc" },
  })
}
