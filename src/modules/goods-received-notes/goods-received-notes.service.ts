import type { GoodsReceivedNoteStatus, Prisma } from "#generated/prisma/client.js"
import { db } from "#core/db.js"
import { BadRequestError, NotFoundError } from "#http/errors.js"
import { paginate } from "#http/pagination.js"
import type { Actor } from "#security/auth.plugin.js"
import { isApprovalRequired, listApprovals, recordApproval } from "#modules/approvals/approvals.service.js"
import { getSettings } from "#modules/settings/settings.service.js"
import {
  GoodsAlreadyReceivedError,
  GoodsReceivedNoteNotCancellableError,
  GoodsReceivedNoteNotEditableError,
  GoodsReceivedNoteNotPendingError,
  GoodsReceivedNoteQuantityError,
  GoodsReceivedNoteSourceError,
} from "./goods-received-notes.errors.js"
import type {
  CreateGoodsReceivedNoteBody,
  GoodsReceivedNoteItemInput,
  ListGoodsReceivedNotesQuery,
  UpdateGoodsReceivedNoteBody,
} from "./goods-received-notes.schema.js"

// Goods received from the supplier in one delivery, the last step of IR → purchase order → GRN. The "order" a GRN
// receives against is a local IR's approved purchase order, or an approved international IR (which has no PO); the GRN
// stores the IR, and the PO is the IR's. Its lines are the order's lines, each with what came this time (0 or more, at
// most what is still outstanding: ordered − what the order's approved GRNs received). One GRN per delivery, and only one
// open (pending or rejected) per order at a time, so a quantity can't be received twice.
// Saving starts the GRN as pending, or as approved when Admin → Approvals says GRNs don't need approval. Approving puts
// its goods in stock (+stockInHand, a StockMovement per product) and, once the order is received in full, sets the PO to
// completed; an approved GRN is final. A pending or rejected GRN can be edited (editing a rejected one submits it again)
// or cancelled. Cancelling the order (its IR or PO) cancels its open GRN, and is refused once goods have been received.
// Every write locks the IR row first, then the GRN's, as the IR and PO cancels do.
//
// NOT BUILT YET: serial numbers. Approving a line of a serial-tracked product will need one serial per unit
// (StockMovement.serialNumber) once the Serial numbers module exists.

const SCREEN = "GOODS_RECEIVED_NOTES"

const openStatuses: GoodsReceivedNoteStatus[] = ["pending", "rejected"]
const isOpen = (status: GoodsReceivedNoteStatus) => openStatuses.includes(status)

const person = { select: { id: true, name: true } } as const
const productRef = { select: { sku: true, title: true, imageUrl: true } } as const
const supplierRef = { select: { id: true, code: true, name: true } } as const

const summaryInclude = {
  internalRequisition: {
    select: {
      id: true,
      internalRequisitionNumber: true,
      isInternational: true,
      purchaseOrder: { select: { id: true, purchaseOrderNumber: true } },
    },
  },
  supplier: supplierRef,
  creator: person,
} satisfies Prisma.GoodsReceivedNoteInclude

// The detail also carries what the printed GRN shows.
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
  items: { where: { isDeleted: false }, orderBy: { lineNo: "asc" }, include: { product: productRef } },
  canceller: person,
} satisfies Prisma.GoodsReceivedNoteInclude

const orderLineSelect = {
  where: { isDeleted: false },
  orderBy: { lineNo: "asc" },
  select: { productId: true, quantity: true, product: productRef },
} as const

export function listGoodsReceivedNotes({ q, status, supplierId, ...page }: ListGoodsReceivedNotesQuery) {
  const where: Prisma.GoodsReceivedNoteWhereInput = {
    ...(q && {
      OR: [
        { grnNumber: { contains: q, mode: "insensitive" } },
        { supplierInvoiceNumber: { contains: q, mode: "insensitive" } },
        { internalRequisition: { internalRequisitionNumber: { contains: q, mode: "insensitive" } } },
        { internalRequisition: { purchaseOrder: { is: { purchaseOrderNumber: { contains: q, mode: "insensitive" } } } } },
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
    (args) => db.goodsReceivedNote.findMany({ where, include: summaryInclude, orderBy: { id: "desc" }, ...args }),
    () => db.goodsReceivedNote.count({ where }),
  )
}

export async function getGoodsReceivedNote(id: number) {
  const [note, approvals] = await Promise.all([
    db.goodsReceivedNote.findUnique({ where: { id }, include: detailInclude }),
    listApprovals(SCREEN, id),
  ])
  if (!note || note.isDeleted) throw new NotFoundError("GRN", String(id))
  return { ...note, approvals }
}

/** What the IR's order has received so far, its GRNs, and why a new GRN can't be made, if it can't. */
export async function getOrderReceipt(internalRequisitionId: number) {
  const order = await loadOrder(internalRequisitionId)
  if (!order) throw new NotFoundError("Internal requisition", String(internalRequisitionId))
  const { requisition, purchaseOrder, supplier, lines, goodsReceivedNotes } = order
  return {
    internalRequisitionId: requisition.id,
    internalRequisitionNumber: requisition.internalRequisitionNumber,
    isInternational: requisition.isInternational,
    purchaseOrder: purchaseOrder && { id: purchaseOrder.id, purchaseOrderNumber: purchaseOrder.purchaseOrderNumber, status: purchaseOrder.status },
    supplier,
    lines,
    goodsReceivedNotes: goodsReceivedNotes.map(({ id, grnNumber, status, receivedDate }) => ({ id, grnNumber, status, receivedDate })),
    blockedReason: newGoodsReceivedNoteProblem(order),
  }
}

export async function createGoodsReceivedNote({ internalRequisitionId, items, ...data }: CreateGoodsReceivedNoteBody, actor: Actor) {
  const { timezone } = await getSettings()

  const { id } = await db.$transaction(async (tx) => {
    // Locks the IR, so its order can't be cancelled or given another GRN meanwhile.
    await lockRequisition(tx, internalRequisitionId)
    const order = await loadOrder(internalRequisitionId, tx)
    if (!order) throw new BadRequestError(`Internal requisition ${internalRequisitionId} doesn't exist or is deleted`)
    const problem = newGoodsReceivedNoteProblem(order)
    if (problem) throw new GoodsReceivedNoteSourceError(problem)

    const lines = buildLines(items, order)
    const status = await savedStatus(tx)
    const note = await tx.goodsReceivedNote.create({
      data: {
        ...data,
        internalRequisitionId,
        supplierId: order.supplier.id,
        receivedDate: data.receivedDate ?? today(timezone),
        status,
        createdBy: actor.id,
      },
    })
    await tx.goodsReceivedNoteItem.createMany({ data: lines.map((line) => ({ ...line, goodsReceivedNoteId: note.id, createdBy: actor.id })) })
    if (status === "approved") await approveOnSave(tx, note, order, actor)
    return note
  })
  return getGoodsReceivedNote(id)
}

/**
 * Pending and rejected only. Sending `items` replaces every line. Every save sets the status again as on create, so
 * editing a rejected GRN submits it again.
 */
export async function updateGoodsReceivedNote(id: number, { items, ...data }: UpdateGoodsReceivedNoteBody, actor: Actor) {
  await db.$transaction(async (tx) => {
    const note = await lockGoodsReceivedNote(tx, id)
    if (!isOpen(note.status)) throw new GoodsReceivedNoteNotEditableError(id, note.status)
    const order = await orderOf(tx, note)
    const problem = sourceProblem(order)
    if (problem) throw new GoodsReceivedNoteSourceError(problem)

    const modified = { modifiedBy: actor.id, modifiedAt: new Date() }
    if (items) {
      const lines = buildLines(items, order)
      await tx.goodsReceivedNoteItem.updateMany({ where: { goodsReceivedNoteId: id, isDeleted: false }, data: { isDeleted: true, ...modified } })
      await tx.goodsReceivedNoteItem.createMany({ data: lines.map((line) => ({ ...line, goodsReceivedNoteId: id, createdBy: actor.id })) })
    }
    const status = await savedStatus(tx)
    await tx.goodsReceivedNote.update({ where: { id }, data: { ...data, status, ...modified } })
    if (status === "approved") await approveOnSave(tx, note, order, actor)
  })
  return getGoodsReceivedNote(id)
}

/** Approves a pending GRN: its goods go into stock, and the PO is completed once the order is received in full. */
export async function approveGoodsReceivedNote(id: number, actor: Actor) {
  await db.$transaction(async (tx) => {
    const note = await lockGoodsReceivedNote(tx, id)
    if (note.status !== "pending") throw new GoodsReceivedNoteNotPendingError(id, note.status)
    const order = await orderOf(tx, note)
    await tx.goodsReceivedNote.update({ where: { id }, data: { status: "approved", modifiedBy: actor.id, modifiedAt: new Date() } })
    await recordApproval(tx, { screen: SCREEN, documentId: id, decision: "approved" }, actor)
    await receive(tx, note, order, actor)
  })
  return getGoodsReceivedNote(id)
}

export async function rejectGoodsReceivedNote(id: number, reason: string, actor: Actor) {
  await db.$transaction(async (tx) => {
    const note = await lockGoodsReceivedNote(tx, id)
    if (note.status !== "pending") throw new GoodsReceivedNoteNotPendingError(id, note.status)
    await tx.goodsReceivedNote.update({ where: { id }, data: { status: "rejected", modifiedBy: actor.id, modifiedAt: new Date() } })
    await recordApproval(tx, { screen: SCREEN, documentId: id, decision: "rejected", reason }, actor)
  })
  return getGoodsReceivedNote(id)
}

/** Pending and rejected only: nothing has gone into stock yet. */
export async function cancelGoodsReceivedNote(id: number, reason: string, actor: Actor) {
  await db.$transaction(async (tx) => {
    const note = await lockGoodsReceivedNote(tx, id)
    if (!isOpen(note.status)) throw new GoodsReceivedNoteNotCancellableError(id, note.status)
    await tx.goodsReceivedNote.update({ where: { id }, data: { status: "cancelled", ...cancelColumns(reason, actor) } })
  })
  return getGoodsReceivedNote(id)
}

/**
 * For the IR's and the PO's cancel, in their transaction with the IR row locked: refuses once the order has received
 * goods (an approved GRN), and cancels its open GRN, if it has one, with the same reason.
 */
export async function cancelGoodsReceivedNotesOfRequisition(
  tx: Prisma.TransactionClient,
  internalRequisitionId: number,
  reason: string,
  actor: Actor,
) {
  const received = await tx.goodsReceivedNote.findFirst({
    where: { internalRequisitionId, status: "approved", isDeleted: false },
    select: { grnNumber: true, internalRequisition: { select: { internalRequisitionNumber: true } } },
  })
  if (received) throw new GoodsAlreadyReceivedError(received.internalRequisition.internalRequisitionNumber, received.grnNumber)
  await tx.goodsReceivedNote.updateMany({
    where: { internalRequisitionId, status: { in: openStatuses }, isDeleted: false },
    data: { status: "cancelled", ...cancelColumns(reason, actor) },
  })
}

type Order = NonNullable<Awaited<ReturnType<typeof loadOrder>>>

/**
 * The IR with what a GRN receives against: its order lines (the PO's for a local IR, none until it has one; the IR's
 * for an international one), each with what the order's approved GRNs received and what is still outstanding, and its
 * GRNs, newest first. null when the IR doesn't exist or is deleted. Pass `tx` to read inside a transaction.
 */
async function loadOrder(internalRequisitionId: number, tx?: Prisma.TransactionClient) {
  const args = {
    where: { id: internalRequisitionId },
    select: {
      id: true,
      internalRequisitionNumber: true,
      isInternational: true,
      status: true,
      isDeleted: true,
      supplier: supplierRef,
      items: orderLineSelect,
      purchaseOrder: { select: { id: true, purchaseOrderNumber: true, status: true, supplier: supplierRef, items: orderLineSelect } },
      goodsReceivedNotes: {
        where: { isDeleted: false },
        orderBy: { id: "desc" },
        select: {
          id: true,
          grnNumber: true,
          status: true,
          receivedDate: true,
          items: { where: { isDeleted: false }, select: { productId: true, receivedQuantity: true } },
        },
      },
    },
  } satisfies Prisma.InternalRequisitionFindUniqueArgs
  const requisition = tx ? await tx.internalRequisition.findUnique(args) : await db.internalRequisition.findUnique(args)
  if (!requisition || requisition.isDeleted) return null

  const { purchaseOrder, goodsReceivedNotes } = requisition
  const received = new Map<string, number>()
  for (const note of goodsReceivedNotes.filter((grn) => grn.status === "approved")) {
    for (const item of note.items) received.set(item.productId, (received.get(item.productId) ?? 0) + item.receivedQuantity)
  }
  const orderLines = requisition.isInternational ? requisition.items : (purchaseOrder?.items ?? [])
  const lines = orderLines.map(({ productId, product, quantity }) => {
    const receivedQuantity = received.get(productId) ?? 0
    return { productId, product, orderedQuantity: quantity, receivedQuantity, outstandingQuantity: Math.max(0, quantity - receivedQuantity) }
  })
  // The goods come from the PO's supplier, which can differ from the IR's.
  return { requisition, purchaseOrder, supplier: (purchaseOrder ?? requisition).supplier, lines, goodsReceivedNotes }
}

/** Why the order can't receive goods at all (the IR's or PO's status), or null. */
function sourceProblem({ requisition, purchaseOrder }: Order) {
  const number = requisition.internalRequisitionNumber
  if (requisition.isInternational) {
    return requisition.status === "approved" ? null : `${number} is ${requisition.status}; goods are received on an approved international IR`
  }
  if (!purchaseOrder) return `${number} has no purchase order yet`
  const { purchaseOrderNumber, status } = purchaseOrder
  if (status === "completed") return `Purchase order ${purchaseOrderNumber} has been received in full`
  return status === "approved" ? null : `Purchase order ${purchaseOrderNumber} is ${status}; goods are received on an approved purchase order`
}

/** Why a new GRN can't be made for the order now, or null. */
function newGoodsReceivedNoteProblem(order: Order) {
  const open = order.goodsReceivedNotes.find((note) => isOpen(note.status))
  if (open) return `${open.grnNumber} is still ${open.status}: approve, edit or cancel it first`
  const problem = sourceProblem(order)
  if (problem) return problem
  if (order.lines.every((line) => line.outstandingQuantity === 0)) {
    return `Everything ordered on ${order.requisition.internalRequisitionNumber} has been received`
  }
  return null
}

/** One line per order line, in the order's order, with what the client says came; checked against what's outstanding. */
function buildLines(items: GoodsReceivedNoteItemInput[], order: Order) {
  const byProduct = new Map(items.map((item) => [item.productId, item]))
  const stranger = items.find((item) => !order.lines.some((line) => line.productId === item.productId))
  if (stranger) throw new BadRequestError(`Product ${stranger.productId} isn't on the order`)

  const lines = order.lines.map((line, index) => {
    const item = byProduct.get(line.productId)
    if (!item) throw new BadRequestError(`Add a line for ${line.product.sku}, with 0 if none of it came`)
    return {
      lineNo: index + 1,
      productId: line.productId,
      orderedQuantity: line.orderedQuantity,
      receivedQuantity: item.receivedQuantity,
      remarks: item.remarks,
    }
  })
  assertWithinOutstanding(lines, order)
  return lines
}

function assertWithinOutstanding(lines: readonly { productId: string; receivedQuantity: number }[], order: Order) {
  for (const { productId, receivedQuantity } of lines) {
    const line = order.lines.find((orderLine) => orderLine.productId === productId)
    const outstanding = line?.outstandingQuantity ?? 0
    if (receivedQuantity > outstanding) {
      throw new GoodsReceivedNoteQuantityError(
        `${line?.product.sku ?? productId}: ${receivedQuantity} received, but only ${outstanding} still outstanding on the order`,
      )
    }
  }
}

/**
 * For a GRN that has just been approved, in that transaction: puts its goods in stock, and completes the PO when the
 * order has now been received in full. `order` was loaded before the approval, so it doesn't count this GRN yet.
 */
async function receive(tx: Prisma.TransactionClient, note: { id: number; grnNumber: string }, order: Order, actor: Actor) {
  const items = await tx.goodsReceivedNoteItem.findMany({
    where: { goodsReceivedNoteId: note.id, isDeleted: false },
    select: { productId: true, receivedQuantity: true },
  })
  assertWithinOutstanding(items, order)
  await addToStock(tx, items, note.grnNumber, actor)

  const receivedNow = new Map(items.map((item) => [item.productId, item.receivedQuantity]))
  const isComplete = order.lines.every((line) => line.outstandingQuantity <= (receivedNow.get(line.productId) ?? 0))
  if (isComplete && order.purchaseOrder) {
    await tx.purchaseOrder.update({
      where: { id: order.purchaseOrder.id },
      data: { status: "completed", modifiedBy: actor.id, modifiedAt: new Date() },
    })
  }
}

/**
 * Adds each quantity to the product's stock in hand and records it as a StockMovement. Products in id order, the order
 * invoices lock them in, so the two can't deadlock.
 */
async function addToStock(
  tx: Prisma.TransactionClient,
  items: readonly { productId: string; receivedQuantity: number }[],
  reference: string,
  actor: Actor,
) {
  const received = items.filter((item) => item.receivedQuantity > 0).toSorted((a, b) => (a.productId < b.productId ? -1 : 1))
  const movements: Prisma.StockMovementCreateManyInput[] = []
  for (const { productId, receivedQuantity } of received) {
    const { stockInHand } = await tx.product.update({
      where: { id: productId },
      data: { stockInHand: { increment: receivedQuantity } },
      select: { stockInHand: true },
    })
    movements.push({
      productId,
      bucket: "inHand",
      quantity: receivedQuantity,
      balanceAfter: stockInHand,
      reference,
      remarks: "GRN approved",
      createdBy: actor.id,
    })
  }
  await tx.stockMovement.createMany({ data: movements })
}

/** pending, or approved when GRNs don't need approval now. */
async function savedStatus(tx: Prisma.TransactionClient): Promise<GoodsReceivedNoteStatus> {
  return (await isApprovalRequired(SCREEN, tx)) ? "pending" : "approved"
}

async function approveOnSave(tx: Prisma.TransactionClient, note: { id: number; grnNumber: string }, order: Order, actor: Actor) {
  await recordApproval(tx, { screen: SCREEN, documentId: note.id, decision: "approved", isAutomatic: true }, actor)
  await receive(tx, note, order, actor)
}

function lockRequisition(tx: Prisma.TransactionClient, internalRequisitionId: number) {
  return tx.$executeRaw`SELECT 1 FROM "InternalRequisition" WHERE id = ${internalRequisitionId} FOR UPDATE`
}

/** Locks the GRN's IR, then the GRN, and returns the GRN as it is now. 404 when it doesn't exist or is deleted. */
async function lockGoodsReceivedNote(tx: Prisma.TransactionClient, id: number) {
  const found = await tx.goodsReceivedNote.findUnique({ where: { id }, select: { internalRequisitionId: true, isDeleted: true } })
  if (!found || found.isDeleted) throw new NotFoundError("GRN", String(id))
  await lockRequisition(tx, found.internalRequisitionId)
  await tx.$executeRaw`SELECT 1 FROM "GoodsReceivedNote" WHERE id = ${id} FOR UPDATE`
  return tx.goodsReceivedNote.findUniqueOrThrow({
    where: { id },
    select: { id: true, grnNumber: true, status: true, internalRequisitionId: true },
  })
}

/** The order of a GRN that exists; its IR can't be removed (Restrict) or deleted (IRs are cancelled, not deleted). */
async function orderOf(tx: Prisma.TransactionClient, note: { internalRequisitionId: number }) {
  const order = await loadOrder(note.internalRequisitionId, tx)
  if (!order) throw new NotFoundError("Internal requisition", String(note.internalRequisitionId))
  return order
}

function cancelColumns(reason: string, actor: Actor) {
  const now = new Date()
  return { cancelReason: reason, cancelledBy: actor.id, cancelledAt: now, modifiedBy: actor.id, modifiedAt: now }
}

/** Today's date in the company timezone, as a @db.Date value. */
function today(timezone: string) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date()) // en-CA gives YYYY-MM-DD
  return new Date(`${day}T00:00:00.000Z`)
}
