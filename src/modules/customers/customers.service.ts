import type { Prisma } from "#generated/prisma/client.js"
import { db } from "#core/db.js"
import { NotFoundError } from "#http/errors.js"
import { paginate } from "#http/pagination.js"
import type { Actor } from "#security/auth.plugin.js"
import type { CreateCustomerBody, ListCustomersQuery, UpdateCustomerBody } from "./customers.schema.js"

// city and district are exact matches, so they use the Customer_city_idx and Customer_district_idx indexes.
export function listCustomers({ q, city, district, includeDeleted, ...page }: ListCustomersQuery) {
  const where: Prisma.CustomerWhereInput = {
    ...(q && {
      OR: [
        { code: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ],
    }),
    ...(city && { city }),
    ...(district && { district }),
    ...(!includeDeleted && { isDeleted: false }),
  }
  return paginate(
    page,
    (args) => db.customer.findMany({ where, orderBy: { name: "asc" }, ...args }),
    () => db.customer.count({ where }),
  )
}

export async function getCustomer(id: string) {
  const customer = await db.customer.findUnique({ where: { id } })
  if (!customer) throw new NotFoundError("Customer", id)
  return customer
}

export function createCustomer(data: CreateCustomerBody, actor: Actor) {
  return db.customer.create({ data: { ...data, createdBy: actor.id } })
}

// Unknown id → Prisma P2025 → 404 (platform/http/error-handler.plugin.ts).
export function updateCustomer(id: string, data: UpdateCustomerBody, actor: Actor) {
  return db.customer.update({ where: { id }, data: { ...data, modifiedBy: actor.id, modifiedAt: new Date() } })
}

/** Customers are never deleted: they're deactivated, so their history stays. `PATCH { isDeleted: false }` restores one. */
export async function deleteCustomer(id: string, actor: Actor) {
  await updateCustomer(id, { isDeleted: true }, actor)
}
