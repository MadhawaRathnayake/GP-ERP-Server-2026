import type { Prisma } from "#generated/prisma/client.js"
import { db } from "#core/db.js"
import { NotFoundError } from "#http/errors.js"
import { paginate } from "#http/pagination.js"
import type { Actor } from "#security/auth.plugin.js"
import type { CreateProductBody, ListProductsQuery, UpdateProductBody } from "./products.schema.js"

export function listProducts({ sku, includeInactive, ...page }: ListProductsQuery) {
  const where: Prisma.ProductWhereInput = {
    ...(sku && { sku: { contains: sku, mode: "insensitive" } }),
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

export function createProduct(data: CreateProductBody, actor: Actor) {
  return db.product.create({ data: { ...data, createdBy: actor.id } })
}

// Unknown id → Prisma P2025 → 404, duplicate sku → P2002 → 409 (platform/http/error-handler.plugin.ts).
export function updateProduct(id: string, data: UpdateProductBody, actor: Actor) {
  return db.product.update({ where: { id }, data: { ...data, modifiedBy: actor.id, modifiedAt: new Date() } })
}

/** Products are never deleted: they're deactivated, so their history stays. `PATCH { isActive: true }` restores one. */
export async function deleteProduct(id: string, actor: Actor) {
  await updateProduct(id, { isActive: false }, actor)
}
