import type { Prisma } from "#generated/prisma/client.js"
import { db } from "#core/db.js"
import type { Actor } from "#security/auth.plugin.js"

/** Current stock of every active product: what a client loads to catch up on changes it may have missed. */
export function listStockLevels() {
  return db.product.findMany({
    where: { isDeleted: false },
    select: { id: true, stockInHand: true, stockVersion: true },
    orderBy: { id: "asc" },
  })
}

export interface StockChange {
  productId: string
  quantity: number // signed: + adds to stock in hand, - takes from it
}

/** What the movements of one change share: the reason, and the source document (an invoice or a GRN) with its number. */
export type StockMovementSource = Pick<Prisma.StockMovementUncheckedCreateInput, "remarks" | "reference" | "invoiceId" | "goodsReceivedNoteId">

/**
 * The one way stock in hand changes: adds each signed quantity to the product's stock in hand and records it as a
 * StockMovement with the balance after, in the caller's transaction. Zero quantities are skipped. Products are updated
 * in id order, the order invoices and GRNs lock them in, so two documents can't deadlock. Checking that stock stays at
 * or above zero is the caller's job.
 */
export async function changeStock(
  tx: Prisma.TransactionClient,
  changes: readonly StockChange[],
  source: StockMovementSource,
  actor: Actor,
) {
  const sorted = changes.filter((change) => change.quantity !== 0).toSorted((a, b) => (a.productId < b.productId ? -1 : 1))
  const movements: Prisma.StockMovementCreateManyInput[] = []
  for (const { productId, quantity } of sorted) {
    const { stockInHand } = await tx.product.update({
      where: { id: productId },
      data: { stockInHand: { increment: quantity } },
      select: { stockInHand: true },
    })
    movements.push({ ...source, productId, quantity, balanceAfter: stockInHand, createdBy: actor.id })
  }
  if (movements.length > 0) await tx.stockMovement.createMany({ data: movements })
}
