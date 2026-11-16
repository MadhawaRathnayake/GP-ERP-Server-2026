import { db } from "#core/db.js"
import { BadRequestError, ConflictError, NotFoundError } from "#http/errors.js"
import type { Actor } from "#security/auth.plugin.js"
import type {
  CreateAccessoryBody,
  ListAccessoriesQuery,
  SetProductAccessoriesBody,
  UpdateAccessoryBody,
} from "./accessories.schema.js"

// The list of things that can come in a product's box with their own serial (Admin), what comes with each product
// (ProductAccessory), and, in modules/serial-items, the serials of a unit's accessories.

const include = { product: { select: { id: true, sku: true, title: true } } } as const

export function listAccessories({ includeDeleted }: ListAccessoriesQuery) {
  return db.accessory.findMany({ where: includeDeleted ? {} : { isDeleted: false }, include, orderBy: { name: "asc" } })
}

export async function getAccessory(id: string) {
  const accessory = await db.accessory.findUnique({ where: { id }, include })
  if (!accessory) throw new NotFoundError("Accessory", id)
  return accessory
}

// Duplicate name → P2002 → 409 (platform/http/error-handler.plugin.ts).
export async function createAccessory(data: CreateAccessoryBody, actor: Actor) {
  if (data.productId) await assertProduct(data.productId)
  return db.accessory.create({ data: { ...data, createdBy: actor.id }, include })
}

// Unknown id → P2025 → 404.
export async function updateAccessory(id: string, data: UpdateAccessoryBody, actor: Actor) {
  if (data.productId) await assertProduct(data.productId)
  if (data.isDeleted === true) {
    const inUse = await db.productAccessory.count({ where: { accessoryId: id, isDeleted: false } })
    if (inUse > 0) throw new ConflictError(`Accessory ${id} comes with ${inUse} product(s); take it off them first`)
  }
  return db.accessory.update({ where: { id }, data: { ...data, modifiedBy: actor.id, modifiedAt: new Date() }, include })
}

/** Never deleted: deactivated, so the serials recorded against it keep their name. `PATCH { isDeleted: false }` restores one. */
export async function deleteAccessory(id: string, actor: Actor) {
  await updateAccessory(id, { isDeleted: true }, actor)
}

const productAccessorySelect = {
  accessoryId: true,
  quantity: true,
  accessory: { select: { id: true, name: true, isDeleted: true } },
} as const

/** What comes with every unit of the product. */
export async function listProductAccessories(productId: string) {
  await assertProduct(productId)
  return db.productAccessory.findMany({
    where: { productId, isDeleted: false },
    select: productAccessorySelect,
    orderBy: { accessory: { name: "asc" } },
  })
}

/** Replaces the product's list: the old rows are soft-deleted, as lines are on documents. */
export async function setProductAccessories(productId: string, { items }: SetProductAccessoriesBody, actor: Actor) {
  await assertProduct(productId)
  const ids = items.map((item) => item.accessoryId)
  const active = await db.accessory.findMany({ where: { id: { in: ids }, isDeleted: false }, select: { id: true } })
  const missing = ids.filter((id) => !active.some((accessory) => accessory.id === id))
  if (missing.length > 0) throw new BadRequestError(`Accessories don't exist or are deleted: ${missing.join(", ")}`)

  const now = new Date()
  await db.$transaction([
    db.productAccessory.updateMany({
      where: { productId, isDeleted: false },
      data: { isDeleted: true, modifiedBy: actor.id, modifiedAt: now },
    }),
    db.productAccessory.createMany({ data: items.map((item) => ({ productId, ...item, createdBy: actor.id })) }),
  ])
  return listProductAccessories(productId)
}

async function assertProduct(id: string) {
  const product = await db.product.findUnique({ where: { id }, select: { id: true } })
  if (!product) throw new NotFoundError("Product", id)
}
