import { Prisma } from "#generated/prisma/client.js"
import { db } from "#core/db.js"
import { BadRequestError, NotFoundError } from "#http/errors.js"
import { paginate } from "#http/pagination.js"
import type { Actor } from "#security/auth.plugin.js"
import type { CreateProductBody, ListProductsQuery, UpdateProductBody } from "./products.schema.js"

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

export async function createProduct({ additionalInfo, ...data }: CreateProductBody, actor: Actor) {
  await assertActiveCategory(data.categoryId)
  return db.product.create({ data: { ...data, additionalInfo: jsonOrDbNull(additionalInfo), createdBy: actor.id } })
}

// Unknown id → Prisma P2025 → 404, duplicate sku → P2002 → 409 (platform/http/error-handler.plugin.ts).
export async function updateProduct(id: string, { additionalInfo, ...data }: UpdateProductBody, actor: Actor) {
  if (data.categoryId) await assertActiveCategory(data.categoryId)
  return db.product.update({
    where: { id },
    data: {
      ...data,
      ...(additionalInfo !== undefined && { additionalInfo: jsonOrDbNull(additionalInfo) }),
      modifiedBy: actor.id,
      modifiedAt: new Date(),
    },
  })
}

/** Products are never deleted: they're deactivated, so their history stays. `PATCH { isActive: true }` restores one. */
export async function deleteProduct(id: string, actor: Actor) {
  await updateProduct(id, { isActive: false }, actor)
}

async function assertActiveCategory(id: string) {
  const category = await db.category.findUnique({ where: { id }, select: { isActive: true } })
  if (!category?.isActive) throw new BadRequestError(`Category ${id} doesn't exist or is deleted`)
}

// Prisma writes SQL NULL into a Json column only through Prisma.DbNull; a plain null is rejected.
const jsonOrDbNull = (value: Prisma.InputJsonObject | null) => value ?? Prisma.DbNull
