import { Prisma, type PurchaseOrderStatus } from "#generated/prisma/client.js"
import { db } from "#core/db.js"
import { BadRequestError, ForbiddenError, NotFoundError } from "#http/errors.js"
import { paginate } from "#http/pagination.js"
import type { Actor } from "#security/auth.plugin.js"
import type { PermissionKey } from "#security/permissions.js"
import { isApprovalRequired, listApprovals, recordApproval } from "#modules/approvals/approvals.service.js"
import { cancelGoodsReceivedNotesOfRequisition } from "#modules/goods-received-notes/goods-received-notes.service.js"
import { lineAmounts, quotationTotals, roundMoney } from "#modules/quotations/quotations.amounts.js"
import { getSettings } from "#modules/settings/settings.service.js"
import {
  PurchaseOrderNotCancellableError,
  PurchaseOrderNotEditableError,
  PurchaseOrderNotPendingError,
  PurchaseOrderSourceError,
} from "./purchase-orders.errors.js"
import type {
  CreatePurchaseOrderBody,
  ListPurchaseOrdersQuery,
  PurchaseOrderItemInput,
  UpdatePurchaseOrderBody,
} from "./purchase-orders.schema.js"

// An order to the supplier for a local internal requisition (international IRs have none), the second step of
// IR → purchase order → GRN. It doesn't move stock. Saving the first PO of a pending IR approves the IR in the same
// transaction ("Approve & create purchase order"); an IR approved on its own gets its PO from "Create purchase order".
// The lines are the IR's products, repriced, discounted, with other quantities or fewer of them; never others. The
// server works out every amount (quotations.amounts.ts) with the VAT rate from the settings.
// Saving starts the PO as pending, or as approved when Admin → Approvals says purchase orders don't need approval. A
// pending PO is approved or rejected; a pending or rejected one can be edited, and editing a rejected one submits it
// again. Cancelling needs a reason and cancels the IR too, as in the old system (and cancelling the IR cancels its PO),
// and its open GRN; it's refused once goods have been received on a GRN. Both lock the IR row first, then the PO's.
// An approved PO becomes completed when its GRNs have received every line in full (modules/goods-received-notes).

const SCREEN = "PURCHASE_ORDERS"

const person = { select: { id: true, name: true } } as const

const summaryInclude = {
  internalRequisition: { select: { id: true, internalRequisitionNumber: true } },
  supplier: { select: { id: true, code: true, name: true } },
  creator: person,
} satisfies Prisma.PurchaseOrderInclude

// The detail also carries what the printed PO shows.
const detailInclude = {
  ...summaryInclude,
  supplier: {
    select: {
      id: true,
      code: true,
      name: true,
      vatNumber: true,
      email: true,
      phones: true,
      houseNumber: true,
      street: true,
      city: true,
      district: true,
      province: true,
      country: true,
    },
  },
  items: {
    where: { isDeleted: false },
    orderBy: { lineNo: "asc" },
    include: { product: { select: { sku: true, title: true, imageUrl: true } } },
  },
  canceller: person,
} satisfies Prisma.PurchaseOrderInclude

const cancelledStatuses: PurchaseOrderStatus[] = ["cancelled", "cancelledAfterApproved"]

export function listPurchaseOrders({ q, status, supplierId, ...page }: ListPurchaseOrdersQuery) {
  const where: Prisma.PurchaseOrderWhereInput = {
    ...(q && {
      OR: [
        { purchaseOrderNumber: { contains: q, mode: "insensitive" } },
        { internalRequisition: { internalRequisitionNumber: { contains: q, mode: "insensitive" } } },
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
    (args) => db.purchaseOrder.findMany({ where, include: summaryInclude, orderBy: { id: "desc" }, ...args }),
    () => db.purchaseOrder.count({ where }),
  )
}

export async function getPurchaseOrder(id: number) {
  const [order, approvals] = await Promise.all([
    db.purchaseOrder.findUnique({ where: { id }, include: detailInclude }),
    listApprovals(SCREEN, id),
  ])
  if (!order || order.isDeleted) throw new NotFoundError("Purchase order", String(id))
  return { ...order, approvals }
}

/**
 * From a local IR that is approved, or pending: then this save approves it too, which needs
 * INTERNAL_REQUISITIONS.APPROVE as well.
 */
export async function createPurchaseOrder(
  { internalRequisitionId, items, ...data }: CreatePurchaseOrderBody,
  actor: Actor,
  permissions: readonly PermissionKey[],
) {
  const { timezone, vatRate } = await getSettings()
  await assertActiveSupplier(data.supplierId)

  const { id } = await db.$transaction(async (tx) => {
    // Locks the IR, so it can't be approved, rejected, cancelled or given another PO meanwhile.
    await tx.$executeRaw`SELECT 1 FROM "InternalRequisition" WHERE id = ${internalRequisitionId} FOR UPDATE`
    const requisition = await tx.internalRequisition.findUnique({
      where: { id: internalRequisitionId },
      select: {
        internalRequisitionNumber: true,
        status: true,
        isInternational: true,
        isDeleted: true,
        purchaseOrder: { select: { purchaseOrderNumber: true } },
        items: { where: { isDeleted: false }, select: { productId: true } },
      },
    })
    if (!requisition || requisition.isDeleted) throw new BadRequestError(`Internal requisition ${internalRequisitionId} doesn't exist or is deleted`)
    const number = requisition.internalRequisitionNumber
    if (requisition.isInternational) throw new PurchaseOrderSourceError(`${number} is international, so it has no purchase order`)
    if (requisition.purchaseOrder) throw new PurchaseOrderSourceError(`${number} already has purchase order ${requisition.purchaseOrder.purchaseOrderNumber}`)
    if (requisition.status === "pending") {
      if (!permissions.includes("INTERNAL_REQUISITIONS.APPROVE")) throw new ForbiddenError("INTERNAL_REQUISITIONS.APPROVE")
      await tx.internalRequisition.update({ where: { id: internalRequisitionId }, data: { status: "approved", modifiedBy: actor.id, modifiedAt: new Date() } })
      await recordApproval(tx, { screen: "INTERNAL_REQUISITIONS", documentId: internalRequisitionId, decision: "approved" }, actor)
    } else if (requisition.status !== "approved") {
      throw new PurchaseOrderSourceError(`${number} is ${requisition.status}; a purchase order needs a pending or approved one`)
    }

    const lines = buildLines(items, new Set(requisition.items.map((item) => item.productId)), vatRate)
    const status = await savedStatus(tx)
    const order = await tx.purchaseOrder.create({
      data: {
        ...data,
        internalRequisitionId,
        purchaseOrderDate: data.purchaseOrderDate ?? today(timezone),
        status,
        ...quotationTotals(lines),
        createdBy: actor.id,
      },
    })
    await tx.purchaseOrderItem.createMany({ data: lines.map((line) => ({ ...line, purchaseOrderId: order.id, createdBy: actor.id })) })
    if (status === "approved") await approveOnSave(tx, order.id, actor)
    return order
  })
  return getPurchaseOrder(id)
}

/**
 * Pending and rejected only. Sending `items` replaces every line, with the current VAT rate. Every save sets the status
 * again as on create, so editing a rejected PO submits it again.
 */
export async function updatePurchaseOrder(id: number, { items, ...data }: UpdatePurchaseOrderBody, actor: Actor) {
  if (data.supplierId) await assertActiveSupplier(data.supplierId)
  const { vatRate } = await getSettings()

  await db.$transaction(async (tx) => {
    // Locks the row, so an edit can't cross an approval, a cancel or another edit.
    await tx.$executeRaw`SELECT 1 FROM "PurchaseOrder" WHERE id = ${id} FOR UPDATE`
    const before = await tx.purchaseOrder.findUnique({
      where: { id },
      select: {
        status: true,
        isDeleted: true,
        internalRequisition: { select: { items: { where: { isDeleted: false }, select: { productId: true } } } },
      },
    })
    if (!before || before.isDeleted) throw new NotFoundError("Purchase order", String(id))
    if (before.status !== "pending" && before.status !== "rejected") throw new PurchaseOrderNotEditableError(id, before.status)

    const modified = { modifiedBy: actor.id, modifiedAt: new Date() }
    const lines = items && buildLines(items, new Set(before.internalRequisition.items.map((item) => item.productId)), vatRate)
    if (lines) {
      await tx.purchaseOrderItem.updateMany({ where: { purchaseOrderId: id, isDeleted: false }, data: { isDeleted: true, ...modified } })
      await tx.purchaseOrderItem.createMany({ data: lines.map((line) => ({ ...line, purchaseOrderId: id, createdBy: actor.id })) })
    }
    const status = await savedStatus(tx)
    await tx.purchaseOrder.update({ where: { id }, data: { ...data, ...(lines && quotationTotals(lines)), status, ...modified } })
    if (status === "approved") await approveOnSave(tx, id, actor)
  })
  return getPurchaseOrder(id)
}

export function approvePurchaseOrder(id: number, actor: Actor) {
  return decide(id, "approved", undefined, actor)
}

export function rejectPurchaseOrder(id: number, reason: string, actor: Actor) {
  return decide(id, "rejected", reason, actor)
}

/**
 * Cancels the PO (an approved one → cancelledAfterApproved, any other → cancelled), its IR and its open GRN. Not once
 * goods have been received on a GRN.
 */
export async function cancelPurchaseOrder(id: number, reason: string, actor: Actor) {
  await db.$transaction(async (tx) => {
    const found = await tx.purchaseOrder.findUnique({ where: { id }, select: { internalRequisitionId: true, isDeleted: true } })
    if (!found || found.isDeleted) throw new NotFoundError("Purchase order", String(id))
    // The IR first, then the PO: the order the IR's cancel locks them in.
    await tx.$executeRaw`SELECT 1 FROM "InternalRequisition" WHERE id = ${found.internalRequisitionId} FOR UPDATE`
    await tx.$executeRaw`SELECT 1 FROM "PurchaseOrder" WHERE id = ${id} FOR UPDATE`
    const order = await tx.purchaseOrder.findUniqueOrThrow({ where: { id }, select: { id: true, status: true } })
    if (cancelledStatuses.includes(order.status)) throw new PurchaseOrderNotCancellableError(id, order.status)
    const cancel = await cancelRow(tx, order, reason, actor)
    await cancelGoodsReceivedNotesOfRequisition(tx, found.internalRequisitionId, reason, actor)

    // As in the old system, the IR goes with it (it's approved: a PO is made only from an approved IR).
    await tx.internalRequisition.updateMany({
      where: { id: found.internalRequisitionId, status: "approved" },
      data: { ...cancel, status: "cancelledAfterApproved" },
    })
  })
  return getPurchaseOrder(id)
}

/**
 * For the IR's cancel, in its transaction with the IR row locked: cancels the IR's PO, if it has one that isn't
 * cancelled. Throws if the PO is completed.
 */
export async function cancelPurchaseOrderOfRequisition(
  tx: Prisma.TransactionClient,
  internalRequisitionId: number,
  reason: string,
  actor: Actor,
) {
  await tx.$executeRaw`SELECT 1 FROM "PurchaseOrder" WHERE "internalRequisitionId" = ${internalRequisitionId} FOR UPDATE`
  const order = await tx.purchaseOrder.findUnique({ where: { internalRequisitionId }, select: { id: true, status: true } })
  if (!order || cancelledStatuses.includes(order.status)) return
  await cancelRow(tx, order, reason, actor)
}

/** Sets a locked PO that isn't cancelled to cancelled or cancelledAfterApproved; returns the cancel columns it set. */
async function cancelRow(tx: Prisma.TransactionClient, order: { id: number; status: PurchaseOrderStatus }, reason: string, actor: Actor) {
  if (order.status === "completed") throw new PurchaseOrderNotCancellableError(order.id, order.status)
  const now = new Date()
  const cancel = { cancelReason: reason, cancelledBy: actor.id, cancelledAt: now, modifiedBy: actor.id, modifiedAt: now }
  await tx.purchaseOrder.update({
    where: { id: order.id },
    data: { ...cancel, status: order.status === "approved" ? "cancelledAfterApproved" : "cancelled" },
  })
  return cancel
}

/** Approves or rejects a pending PO and records the decision in the same transaction. */
async function decide(id: number, decision: "approved" | "rejected", reason: string | undefined, actor: Actor) {
  await db.$transaction(async (tx) => {
    // Only while pending; the condition is in the update, so two approvers can't both decide.
    const { count } = await tx.purchaseOrder.updateMany({
      where: { id, status: "pending", isDeleted: false },
      data: { status: decision, modifiedBy: actor.id, modifiedAt: new Date() },
    })
    if (count === 0) {
      const order = await tx.purchaseOrder.findUnique({ where: { id }, select: { status: true, isDeleted: true } })
      if (!order || order.isDeleted) throw new NotFoundError("Purchase order", String(id))
      throw new PurchaseOrderNotPendingError(id, order.status)
    }
    await recordApproval(tx, { screen: SCREEN, documentId: id, decision, ...(reason !== undefined && { reason }) }, actor)
  })
  return getPurchaseOrder(id)
}

/** pending, or approved when purchase orders don't need approval now. */
async function savedStatus(tx: Prisma.TransactionClient): Promise<PurchaseOrderStatus> {
  return (await isApprovalRequired(SCREEN, tx)) ? "pending" : "approved"
}

function approveOnSave(tx: Prisma.TransactionClient, id: number, actor: Actor) {
  return recordApproval(tx, { screen: SCREEN, documentId: id, decision: "approved", isAutomatic: true }, actor)
}

/** Each line numbered, checked to be one of the IR's products, with the VAT rate and its amounts. */
function buildLines(items: PurchaseOrderItemInput[], requisitionProductIds: Set<string>, vatRate: number) {
  const taxRate = new Prisma.Decimal(vatRate)
  return items.map((item, index) => {
    const lineNo = index + 1
    if (!requisitionProductIds.has(item.productId)) {
      throw new BadRequestError(`Line ${lineNo}: product ${item.productId} isn't on the internal requisition`)
    }
    const pricing = {
      quantity: item.quantity,
      unitPrice: roundMoney(item.unitPrice),
      discountType: item.discountType,
      discountValue: roundMoney(item.discountValue),
      taxRate,
    }
    const amounts = lineAmounts(pricing)
    if (amounts.discountAmount.gt(amounts.subtotal)) throw new BadRequestError(`Line ${lineNo}: the discount is more than the line subtotal`)
    return { lineNo, productId: item.productId, ...pricing, ...amounts }
  })
}

async function assertActiveSupplier(id: string) {
  const supplier = await db.supplier.findUnique({ where: { id }, select: { isDeleted: true } })
  if (!supplier || supplier.isDeleted) throw new BadRequestError(`Supplier ${id} doesn't exist or is deleted`)
}

/** Today's date in the company timezone, as a @db.Date value. */
function today(timezone: string) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date()) // en-CA gives YYYY-MM-DD
  return new Date(`${day}T00:00:00.000Z`)
}
