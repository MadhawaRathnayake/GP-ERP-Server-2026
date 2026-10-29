import { z } from "zod"

// Query params shared by every list endpoint. Pages are 1-based to match the frontend.
export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export type PageQuery = z.infer<typeof pageQuery>

/** Response schema for a list endpoint: { data: T[], total } */
export const pageResult = <T extends z.ZodType>(item: T) => z.object({ data: z.array(item), total: z.number().int() })

/**
 * Runs a page query and its count together.
 *   paginate(page, (args) => db.customer.findMany({ where, ...args }), () => db.customer.count({ where }))
 */
export async function paginate<T>(
  { page, limit }: PageQuery,
  findMany: (args: { skip: number; take: number }) => Promise<T[]>,
  count: () => Promise<number>,
): Promise<{ data: T[]; total: number }> {
  const [data, total] = await Promise.all([findMany({ skip: (page - 1) * limit, take: limit }), count()])
  return { data, total }
}
