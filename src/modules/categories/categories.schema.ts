import { z } from "zod"

const categoryId = z.string().regex(/^CAT\d{4,}$/, "Must be a category id like CAT0001")

export const categoryIdParams = z.object({ id: categoryId })

export const category = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  createdBy: z.string().nullable(),
  createdAt: z.date(),
  modifiedBy: z.string().nullable(),
  modifiedAt: z.date().nullable(),
  isActive: z.boolean(),
})

export const categoryList = z.array(category)

export const listCategoriesQuery = z.object({
  includeInactive: z.stringbool().default(false).describe("Include deactivated (deleted) categories"),
})

const categoryFields = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500),
})

export const createCategoryBody = categoryFields.extend({ description: categoryFields.shape.description.default("") })

// From the fields without defaults (see the pitfall in AGENTS.md).
export const updateCategoryBody = categoryFields
  .extend({ isActive: z.boolean().describe("false = deleted: hidden from lists by default") })
  .partial()

export type ListCategoriesQuery = z.infer<typeof listCategoriesQuery>
export type CreateCategoryBody = z.infer<typeof createCategoryBody>
export type UpdateCategoryBody = z.infer<typeof updateCategoryBody>
