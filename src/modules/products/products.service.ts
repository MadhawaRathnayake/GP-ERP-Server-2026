import type { Prisma, Product } from "#generated/prisma/client.js"
import { db } from "#core/db.js"
import { BadRequestError, NotFoundError } from "#http/errors.js"
import { paginate } from "#http/pagination.js"
import type { Actor } from "#security/auth.plugin.js"
import { addUnits, countUnitsInStock, removeUnits } from "#modules/serial-items/serial-items.service.js"
import { changeStock } from "#modules/stock/stock.service.js"
import {
  NothingToRegisterError,
  ProductDeletedError,
  StockBelowZeroError,
  TrackingMismatchError,
  TrackingTypeLockedError,
} from "./products.errors.js"
import type { CreateProductBody, ListProductsQuery, StockAdjustmentBody, UpdateProductBody } from "./products.schema.js"

// Product holds the current price, cost and stock; every change to them is also recorded as a movement, in the same
// transaction, so the movement tables are the full history and the product row is always their latest value. Price
// and cost change on the product form; stock only through documents (GRNs, invoices) and adjustStock.

export function listProducts({ sku, categoryId, includeDeleted, ...page }: ListProductsQuery) {
  const where: Prisma.ProductWhereInput = {
    ...(sku && { sku: { contains: sku, mode: "insensitive" } }),
    ...(categoryId && { categoryId }),
    ...(!includeDeleted && { isDeleted: false }),
  }
  return paginate(
    page,
    (args) => db.product.findMany({ where, orderBy: { createdAt: "desc" }, ...args }),
    () => db.product.count({ where }),
  )
}

export async function getProduct(id: string) {
  const product = await db.product.findUnique({ where: { id } })
  if (!product) throw new NotFoundError("Product", id)
  return product
}

export async function createProduct(data: CreateProductBody, actor: Actor) {
  await assertActiveCategory(data.categoryId)
  return db.$transaction(async (tx) => {
    const product = await tx.product.create({ data: { ...data, createdBy: actor.id } })
    await recordMovements(tx, null, product, actor, "Opening values")
    return product
  })
}

// Duplicate sku → P2002 → 409 (platform/http/error-handler.plugin.ts).
export async function updateProduct(id: string, data: UpdateProductBody, actor: Actor) {
  if (data.categoryId) await assertActiveCategory(data.categoryId)
  return db.$transaction(async (tx) => {
    // Locks the row, so two edits at once can't both record the same "previous" value.
    await tx.$executeRaw`SELECT 1 FROM "Product" WHERE id = ${id} FOR UPDATE`
    const before = await tx.product.findUnique({ where: { id } })
    if (!before) throw new NotFoundError("Product", id)
    if (data.trackingType && data.trackingType !== before.trackingType && (await isTrackingInUse(tx, before))) {
      throw new TrackingTypeLockedError(before.sku)
    }
    const product = await tx.product.update({ where: { id }, data: { ...data, modifiedBy: actor.id, modifiedAt: new Date() } })
    await recordMovements(tx, before, product, actor, "Edited on the product form")
    return product
  })
}

/** Products are never deleted: they're deactivated, so their history stays. `PATCH { isDeleted: false }` restores one. */
export async function deleteProduct(id: string, actor: Actor) {
  await updateProduct(id, { isDeleted: true }, actor)
}

/**
 * Changes stock by hand, recorded as a StockMovement with the reason. A quantity-tracked product takes a signed
 * quantity. A serial-tracked one adds units (stock up), removes units in stock (stock down), or registers serials for
 * old stock that has none (stock unchanged), each unit with its own movement (modules/serial-items).
 */
export async function adjustStock(id: string, { reason, quantity, add, remove, register }: StockAdjustmentBody, actor: Actor) {
  return db.$transaction(async (tx) => {
    // Locked like invoices and GRNs lock it, so a concurrent sale can't take the same stock.
    await tx.$executeRaw`SELECT 1 FROM "Product" WHERE id = ${id} FOR UPDATE`
    const before = await tx.product.findUnique({ where: { id }, select: { sku: true, stockInHand: true, trackingType: true, isDeleted: true } })
    if (!before) throw new NotFoundError("Product", id)
    if (before.isDeleted) throw new ProductDeletedError(before.sku)
    if ((quantity !== undefined) !== (before.trackingType === "quantity")) throw new TrackingMismatchError(before.sku, before.trackingType)

    let change = quantity ?? 0
    if (add) {
      await addUnits(tx, id, add, { remarks: reason }, actor)
      change = add.length
    } else if (remove) {
      await removeUnits(tx, id, remove, reason, actor)
      change = -remove.length
    } else if (register) {
      const withoutSerial = before.stockInHand - (await countUnitsInStock(tx, id))
      if (register.length > withoutSerial) throw new NothingToRegisterError(before.sku, withoutSerial)
      await addUnits(tx, id, register, { remarks: `Registered for stock already counted: ${reason}` }, actor)
    }
    if (change === 0) return tx.product.findUniqueOrThrow({ where: { id } })
    if (before.stockInHand + change < 0) throw new StockBelowZeroError(before.sku, before.stockInHand, change)

    await changeStock(tx, [{ productId: id, quantity: change }], { remarks: reason }, actor)
    return tx.product.update({ where: { id }, data: { modifiedBy: actor.id, modifiedAt: new Date() } })
  })
}

/** Writes a movement for each of price and cost that differs between `before` (null = new product) and `after`. */
async function recordMovements(tx: Prisma.TransactionClient, before: Product | null, after: Product, actor: Actor, remarks: string) {
  const audit = { productId: after.id, remarks, createdBy: actor.id }
  if (!before || !after.price.equals(before.price)) {
    await tx.priceMovement.create({ data: { ...audit, previousPrice: before?.price ?? null, price: after.price } })
  }
  if (!before || !after.cost.equals(before.cost)) {
    await tx.costMovement.create({ data: { ...audit, previousCost: before?.cost ?? null, cost: after.cost } })
  }
}

/**
 * Whether stock has been counted under the product's tracking type: it has stock in hand, serial-numbered units, GRN
 * deliveries or invoice lines. GRNs and invoices handle stock by the product's tracking type at each step (serials
 * added, finalize, cancel), so changing it then would count the same goods twice or never.
 */
async function isTrackingInUse(tx: Prisma.TransactionClient, product: Pick<Product, "id" | "stockInHand">) {
  if (product.stockInHand !== 0) return true
  const productId = product.id
  const [units, delivered, invoiced] = await Promise.all([
    tx.serialItem.count({ where: { productId } }),
    tx.goodsReceivedNoteDeliveryItem.count({ where: { productId, isDeleted: false } }),
    tx.invoiceItem.count({ where: { productId, isDeleted: false } }),
  ])
  return units + delivered + invoiced > 0
}

async function assertActiveCategory(id: string) {
  const category = await db.category.findUnique({ where: { id }, select: { isDeleted: true } })
  if (!category || category.isDeleted) throw new BadRequestError(`Category ${id} doesn't exist or is deleted`)
}
