import { db } from "#core/db.js"
import { ConflictError, NotFoundError } from "#http/errors.js"
import type { Actor } from "#security/auth.plugin.js"
import type { CreateCategoryBody, ListCategoriesQuery, UpdateCategoryBody } from "./categories.schema.js"

export function listCategories({ includeInactive }: ListCategoriesQuery) {
  return db.category.findMany({ where: includeInactive ? {} : { isActive: true }, orderBy: { name: "asc" } })
}

export async function getCategory(id: string) {
  const category = await db.category.findUnique({ where: { id } })
  if (!category) throw new NotFoundError("Category", id)
  return category
}

export function createCategory(data: CreateCategoryBody, actor: Actor) {
  return db.category.create({ data: { ...data, createdBy: actor.id } })
}

// Unknown id → Prisma P2025 → 404, duplicate name → P2002 → 409 (platform/http/error-handler.plugin.ts).
export async function updateCategory(id: string, data: UpdateCategoryBody, actor: Actor) {
  if (data.isActive === false) {
    const inUse = await db.product.count({ where: { categoryId: id, isActive: true } })
    if (inUse > 0) throw new ConflictError(`Category ${id} is used by ${inUse} active product(s); move or delete them first`)
  }
  return db.category.update({ where: { id }, data: { ...data, modifiedBy: actor.id, modifiedAt: new Date() } })
}

/** Categories are never deleted: they're deactivated, so products keep their history. `PATCH { isActive: true }` restores one. */
export async function deleteCategory(id: string, actor: Actor) {
  await updateCategory(id, { isActive: false }, actor)
}
