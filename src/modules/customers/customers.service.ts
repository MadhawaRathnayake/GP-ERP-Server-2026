import type { Prisma } from "#generated/prisma/client.js"
import { db } from "#core/db.js"
import { NotFoundError } from "#http/errors.js"
import { paginate } from "#http/pagination.js"
import type { CreateCustomerBody, ListCustomersQuery } from "./customers.schema.js"
import type { Actor } from "#security/auth.plugin.js"

export function listCustomers({ q, ...page }: ListCustomersQuery) {
  const where: Prisma.CustomerWhereInput = q
    ? {
        OR: [
          { code: { contains: q, mode: "insensitive" } },
          { name: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
        ],
      }
    : {}
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

export async function createCustomer(data: CreateCustomerBody, actor: Actor) {
  return db.$transaction(async (tx) => {
    const customer = await tx.customer.create({ data: { ...data, createdBy: actor.id } })
    return customer
  })
}