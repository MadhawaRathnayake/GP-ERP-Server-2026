import { z } from "zod"
import { money } from "#http/fields.js"
import { pageQuery, pageResult } from "#http/pagination.js"

// PLACEHOLDER: fields mirror the minimal Customer model in prisma/schema.prisma. Add the real ones in both places.
export const customer = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  creditLimit: money,
  createdBy: z.string().nullable(),
  createdAt: z.date(),
  modifiedBy: z.string().nullable(),
  modifiedAt: z.date().nullable(),
  isActive: z.boolean(),
})

export const customerPage = pageResult(customer)

export const listCustomersQuery = pageQuery.extend({
  q: z.string().trim().min(1).optional().describe("Case-insensitive partial match on code, name or email"),
})

export type ListCustomersQuery = z.infer<typeof listCustomersQuery>
