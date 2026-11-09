import type { InternalRequisitionStatus, Prisma } from "#generated/prisma/client.js"
import { db } from "#core/db.js"
import { BadRequestError, NotFoundError } from "#http/errors.js"
import { paginate } from "#http/pagination.js"
import type { Actor } from "#security/auth.plugin.js"
import { isApprovalRequired, listApprovals, recordApproval } from "#modules/approvals/approvals.service.js"
import {
  InternalRequisitionCancelledError,
  InternalRequisitionNotEditableError,
  InternalRequisitionNotPendingError,
} from "./internal-requisitions.errors.js"
import type {
  CreateInternalRequisitionBody,
  InternalRequisitionItemInput,
  ListInternalRequisitionsQuery,
  UpdateInternalRequisitionBody,
} from "./internal-requisitions.schema.js"

// A request to buy products from one supplier, the first step of IR → purchase order → GRN. It doesn't move stock.
// Saving starts it as pending, or as approved (an automatic Approval row) when Admin → Approvals says internal
// requisitions don't need approval. A pending IR is approved or rejected (modules/approvals keeps every decision); a
// pending or rejected one can be edited, and editing a rejected one submits it again. Cancelling needs a reason.
//
// NOT BUILT YET: purchase orders and GRNs. When they exist, an approved IR with a purchase order (or, international,
// with a GRN) can't be cancelled; check that in cancelInternalRequisition.

const SCREEN = "INTERNAL_REQUISITIONS"

const person = { select: { id: true, name: true } } as const

const summaryInclude = {
  supplier: { select: { id: true, code: true, name: true } },
  creator: person,
} satisfies Prisma.InternalRequisitionInclude

// The detail also carries what the printed IR shows.
const detailInclude = {
  ...summaryInclude,
  supplier: { select: { id: true, code: true, name: true, vatNumber: true } },
  items: {
    where: { isDeleted: false },
    orderBy: { lineNo: "asc" },
    include: { product: { select: { sku: true, title: true, imageUrl: true } } },
  },
  canceller: person,
} satisfies Prisma.InternalRequisitionInclude

const cancelledStatuses: InternalRequisitionStatus[] = ["cancelled", "cancelledAfterApproved"]

export function listInternalRequisitions({ q, status, supplierId, ...page }: ListInternalRequisitionsQuery) {
  const where: Prisma.InternalRequisitionWhereInput = {
    ...(q && {
      OR: [
        { internalRequisitionNumber: { contains: q, mode: "insensitive" } },
        { supplier: { code: { contains: q, mode: "insensitive" } } },
        { supplier: { name: { contains: q, mode: "insensitive" } } },
      ],
    }),
    ...(status && { status }),
    ...(supplierId && { supplierId }),
    isDeleted: false,
  }
  return paginate(
    page,
    (args) => db.internalRequisition.findMany({ where, include: summaryInclude, orderBy: { id: "desc" }, ...args }),
    () => db.internalRequisition.count({ where }),
  )
}

export async function getInternalRequisition(id: number) {
  const [requisition, approvals] = await Promise.all([
    db.internalRequisition.findUnique({ where: { id }, include: detailInclude }),
    listApprovals(SCREEN, id),
  ])
  if (!requisition || requisition.isDeleted) throw new NotFoundError("Internal requisition", String(id))
  return { ...requisition, approvals }
}

export async function createInternalRequisition({ items, ...data }: CreateInternalRequisitionBody, actor: Actor) {
  await assertActiveSupplier(data.supplierId)
  const lines = await buildLines(items)

  const { id } = await db.$transaction(async (tx) => {
    const status = await savedStatus(tx)
    const requisition = await tx.internalRequisition.create({ data: { ...data, status, createdBy: actor.id } })
    await tx.internalRequisitionItem.createMany({
      data: lines.map((line) => ({ ...line, internalRequisitionId: requisition.id, createdBy: actor.id })),
    })
    if (status === "approved") await approveOnSave(tx, requisition.id, actor)
    return requisition
  })
  return getInternalRequisition(id)
}

/**
 * Pending and rejected only. Sending `items` replaces every line, with the products' current stock figures. Every save
 * sets the status again as on create, so editing a rejected IR submits it again.
 */
export async function updateInternalRequisition(id: number, { items, ...data }: UpdateInternalRequisitionBody, actor: Actor) {
  if (data.supplierId) await assertActiveSupplier(data.supplierId)
  const lines = items && (await buildLines(items))

  await db.$transaction(async (tx) => {
    // Locks the row, so an edit can't cross an approval, a cancel or another edit.
    await tx.$executeRaw`SELECT 1 FROM "InternalRequisition" WHERE id = ${id} FOR UPDATE`
    const before = await tx.internalRequisition.findUnique({ where: { id }, select: { status: true, isDeleted: true } })
    if (!before || before.isDeleted) throw new NotFoundError("Internal requisition", String(id))
    if (before.status !== "pending" && before.status !== "rejected") throw new InternalRequisitionNotEditableError(id, before.status)

    const modified = { modifiedBy: actor.id, modifiedAt: new Date() }
    if (lines) {
      await tx.internalRequisitionItem.updateMany({ where: { internalRequisitionId: id, isDeleted: false }, data: { isDeleted: true, ...modified } })
      await tx.internalRequisitionItem.createMany({ data: lines.map((line) => ({ ...line, internalRequisitionId: id, createdBy: actor.id })) })
    }
    const status = await savedStatus(tx)
    await tx.internalRequisition.update({ where: { id }, data: { ...data, status, ...modified } })
    if (status === "approved") await approveOnSave(tx, id, actor)
  })
  return getInternalRequisition(id)
}

export function approveInternalRequisition(id: number, actor: Actor) {
  return decide(id, "approved", undefined, actor)
}

export function rejectInternalRequisition(id: number, reason: string, actor: Actor) {
  return decide(id, "rejected", reason, actor)
}

/** Cancels a pending or rejected IR (→ cancelled) or an approved one (→ cancelledAfterApproved). */
export async function cancelInternalRequisition(id: number, reason: string, actor: Actor) {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "InternalRequisition" WHERE id = ${id} FOR UPDATE`
    const requisition = await tx.internalRequisition.findUnique({ where: { id }, select: { status: true, isDeleted: true } })
    if (!requisition || requisition.isDeleted) throw new NotFoundError("Internal requisition", String(id))
    if (cancelledStatuses.includes(requisition.status)) throw new InternalRequisitionCancelledError(id)

    const now = new Date()
    await tx.internalRequisition.update({
      where: { id },
      data: {
        status: requisition.status === "approved" ? "cancelledAfterApproved" : "cancelled",
        cancelReason: reason,
        cancelledBy: actor.id,
        cancelledAt: now,
        modifiedBy: actor.id,
        modifiedAt: now,
      },
    })
  })
  return getInternalRequisition(id)
}

/** Approves or rejects a pending IR and records the decision in the same transaction. */
async function decide(id: number, decision: "approved" | "rejected", reason: string | undefined, actor: Actor) {
  await db.$transaction(async (tx) => {
    // Only while pending; the condition is in the update, so two approvers can't both decide.
    const { count } = await tx.internalRequisition.updateMany({
      where: { id, status: "pending", isDeleted: false },
      data: { status: decision, modifiedBy: actor.id, modifiedAt: new Date() },
    })
    if (count === 0) {
      const requisition = await tx.internalRequisition.findUnique({ where: { id }, select: { status: true, isDeleted: true } })
      if (!requisition || requisition.isDeleted) throw new NotFoundError("Internal requisition", String(id))
      throw new InternalRequisitionNotPendingError(id, requisition.status)
    }
    await recordApproval(tx, { screen: SCREEN, documentId: id, decision, ...(reason !== undefined && { reason }) }, actor)
  })
  return getInternalRequisition(id)
}

/** pending, or approved when internal requisitions don't need approval now. */
async function savedStatus(tx: Prisma.TransactionClient): Promise<InternalRequisitionStatus> {
  return (await isApprovalRequired(SCREEN, tx)) ? "pending" : "approved"
}

function approveOnSave(tx: Prisma.TransactionClient, id: number, actor: Actor) {
  return recordApproval(tx, { screen: SCREEN, documentId: id, decision: "approved", isAutomatic: true }, actor)
}

/** Each line numbered, with the product's stock in hand and minimum stock copied as they are now. */
async function buildLines(items: InternalRequisitionItemInput[]) {
  const products = await db.product.findMany({
    where: { id: { in: items.map((item) => item.productId) } },
    select: { id: true, stockInHand: true, minimumStock: true, isDeleted: true },
  })
  const byId = new Map(products.map((product) => [product.id, product]))

  return items.map((item, index) => {
    const lineNo = index + 1
    const product = byId.get(item.productId)
    if (!product || product.isDeleted) throw new BadRequestError(`Line ${lineNo}: product ${item.productId} doesn't exist or is deleted`)
    return {
      lineNo,
      productId: product.id,
      quantity: item.quantity,
      stockInHand: product.stockInHand,
      minimumStock: product.minimumStock,
    }
  })
}

async function assertActiveSupplier(id: string) {
  const supplier = await db.supplier.findUnique({ where: { id }, select: { isDeleted: true } })
  if (!supplier || supplier.isDeleted) throw new BadRequestError(`Supplier ${id} doesn't exist or is deleted`)
}
