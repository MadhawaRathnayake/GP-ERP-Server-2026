import type { Prisma, Product, StockBucket } from "#generated/prisma/client.js"
import { db } from "#core/db.js"
import { BadRequestError, NotFoundError } from "#http/errors.js"
import { paginate } from "#http/pagination.js"
import type { Actor } from "#security/auth.plugin.js"
import type { CreateProductBody, ListProductsQuery, UpdateProductBody } from "./products.schema.js"

// Product holds the current price, cost and stock; every change to them is also recorded as a movement, in the same
// transaction, so the movement tables are the full history and the product row is always their latest value.
const STOCK_COLUMNS = {
  inHand: "stockInHand",
  preOrder: "stockPreOrder",
  inTransit: "stockInTransit",
  onArrival: "stockOnArrival",
} as const satisfies Record<StockBucket, keyof Product>

export function listProducts({ sku, categoryId, includeInactive, ...page }: ListProductsQuery) {
  const where: Prisma.ProductWhereInput = {
    ...(sku && { sku: { contains: sku, mode: "insensitive" } }),
    ...(categoryId && { categoryId }),
    ...(!includeInactive && { isActive: true }),
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
    const product = await tx.product.update({ where: { id }, data: { ...data, modifiedBy: actor.id, modifiedAt: new Date() } })
    await recordMovements(tx, before, product, actor, "Edited on the product form")
    return product
  })
}

/** Products are never deleted: they're deactivated, so their history stays. `PATCH { isActive: true }` restores one. */
export async function deleteProduct(id: string, actor: Actor) {
  await updateProduct(id, { isActive: false }, actor)
}

/** Writes a movement for each of price, cost and stock that differs between `before` (null = new product) and `after`. */
async function recordMovements(tx: Prisma.TransactionClient, before: Product | null, after: Product, actor: Actor, remarks: string) {
  const audit = { productId: after.id, remarks, createdBy: actor.id }
  if (!before || !after.price.equals(before.price)) {
    await tx.priceMovement.create({ data: { ...audit, previousPrice: before?.price ?? null, price: after.price } })
  }
  if (!before || !after.cost.equals(before.cost)) {
    await tx.costMovement.create({ data: { ...audit, previousCost: before?.cost ?? null, cost: after.cost } })
  }
  const stock = Object.entries(STOCK_COLUMNS).flatMap(([bucket, column]) => {
    const quantity = after[column] - (before?.[column] ?? 0)
    return quantity === 0 ? [] : [{ ...audit, bucket: bucket as StockBucket, quantity, balanceAfter: after[column] }]
  })
  if (stock.length > 0) await tx.stockMovement.createMany({ data: stock })
}

async function assertActiveCategory(id: string) {
  const category = await db.category.findUnique({ where: { id }, select: { isActive: true } })
  if (!category?.isActive) throw new BadRequestError(`Category ${id} doesn't exist or is deleted`)
}
