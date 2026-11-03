import { db } from "#core/db.js";
import type { Prisma } from "#generated/prisma/client.js";
import { NotFoundError } from "#http/errors.js";
import { paginate } from "#http/pagination.js";
import type { Actor } from "#security/auth.plugin.js";
import type { CreateSupplierBody, ListSuppliersQuery, UpdateSupplierBody } from "./suppliers.schema.js";

export function listSuppliers({ q, includeDeleted, ...page }: ListSuppliersQuery) {
    const where: Prisma.SupplierWhereInput = {
    ...(q && {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ],
    }),
    ...(!includeDeleted && { isDeleted: false }),
  }
  return paginate(
    page,
    (args) => db.supplier.findMany({ where, orderBy: { name: "asc" }, ...args }),
    () => db.supplier.count({ where }),
  )
}

export async function getSupplier(id: string) {
    const supplier = await db.supplier.findUnique({ where: {id}})
    if (!supplier) throw new NotFoundError("Customer", id)
    return supplier
}

export async function createSupplier(data: CreateSupplierBody, actor: Actor) {
    return db.supplier.create({ data: { ...data, createdBy: actor.id }})
}

export async function updateSupplier(id: string, data: UpdateSupplierBody, actor: Actor) {
    return db.supplier.update({ where: { id }, data: { ...data, modifiedBy: actor.id, modifiedAt: new Date() }})
}

export async function deleteSupplier(id: string, actor: Actor) {
    await updateSupplier(id, {isDeleted: true}, actor)
}