import type { GoodsReceivedNoteStatus, Prisma } from "#generated/prisma/client.js"
import { db } from "#core/db.js"
import { BadRequestError, NotFoundError } from "#http/errors.js"
import { paginate } from "#http/pagination.js"
import type { Actor } from "#security/auth.plugin.js"
import { addUnits } from "#modules/serial-items/serial-items.service.js"
import { getSettings, today } from "#modules/settings/settings.service.js"
import { changeStock } from "#modules/stock/stock.service.js"
import {
  GoodsAlreadyReceivedError,
  GoodsReceivedNoteQuantityError,
  GoodsReceivedNoteSerialsError,
  GoodsReceivedNoteSourceError,
} from "./goods-received-notes.errors.js"
import type { AddSerialsBody, CreateGoodsReceivedNoteBody, DeliveryBody, ListGoodsReceivedNotesQuery } from "./goods-received-notes.schema.js"

// The goods received against one order, the last step of IR → purchase order → GRN (docs/plans/serial-numbers.md
// §3.10). The "order" is a local IR's approved purchase order, or an approved international IR (which has no PO); the
// GRN stores the IR, and the PO is the IR's. One GRN per order, holding every order line, received in batches: the first
// delivery creates the GRN, later ones are added to it. There is no approval: saving a delivery puts its
// quantity-tracked goods in stock at once (+stockInHand, a StockMovement per product). Serial-tracked goods go into
// stock one unit at a time as their serials are added (modules/serial-items), the last step. The status follows:
// needSerialNumbers while a serial line misses serials, else partiallyCompleted while something is still to come, else
// completed; the PO becomes completed once everything has arrived. A saved delivery is final (a mistake is fixed with a
// stock adjustment), and an order with a GRN can't be cancelled. Every write locks the IR row first, then the GRN's.
// Deliveries imported from the old system (isImported, scripts/import-old-supply.ts) were put in stock there, so their
// serial-tracked units aren't asked for serials.

const person = { select: { id: true, name: true } } as const
const productRef = { select: { sku: true, title: true, imageUrl: true, trackingType: true } } as const
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
  deliveries: {
    where: { isDeleted: false },
    orderBy: { deliveryNo: "asc" },
    select: { deliveryNo: true, receivedDate: true, supplierInvoiceNumber: true },
  },
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
  deliveries: {
    where: { isDeleted: false },
    orderBy: { deliveryNo: "asc" },
    select: {
      id: true,
      deliveryNo: true,
      receivedDate: true,
      supplierInvoiceNumber: true,
      remarks: true,
      isImported: true,
      creator: person,
      createdAt: true,
      items: {
        where: { isDeleted: false },
        orderBy: { id: "asc" },
        select: { productId: true, quantity: true, remarks: true, product: { select: { sku: true, title: true } } },
      },
    },
  },
} satisfies Prisma.GoodsReceivedNoteInclude

const orderLineSelect = {
  where: { isDeleted: false },
  orderBy: { lineNo: "asc" },
  select: { productId: true, quantity: true, product: productRef },
} as const

export function listGoodsReceivedNotes({ q, status, supplierId, ...page }: ListGoodsReceivedNotesQuery) {
  const contains = q && { contains: q, mode: "insensitive" as const }
  const where: Prisma.GoodsReceivedNoteWhereInput = {
    ...(contains && {
      OR: [
        { grnNumber: contains },
        { deliveries: { some: { supplierInvoiceNumber: contains, isDeleted: false } } },
        { internalRequisition: { internalRequisitionNumber: contains } },
        { internalRequisition: { purchaseOrder: { is: { purchaseOrderNumber: contains } } } },
        { supplier: { code: contains } },
        { supplier: { name: contains } },
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
  const [note, serials, imported] = await Promise.all([
    db.goodsReceivedNote.findUnique({ where: { id }, include: detailInclude }),
    serialCounts(db, id),
    importedQuantities(db, id),
  ])
  if (!note || note.isDeleted) throw new NotFoundError("GRN", String(id))
  return {
    ...note,
    items: note.items.map((item) => {
      const serialsEntered = item.product.trackingType === "serial" ? (serials.get(item.productId) ?? 0) : 0
      return {
        ...item,
        outstandingQuantity: Math.max(0, item.orderedQuantity - item.receivedQuantity),
        serialsEntered,
        serialsMissing:
          item.product.trackingType === "serial" ? item.receivedQuantity - (imported.get(item.productId) ?? 0) - serialsEntered : 0,
      }
    }),
  }
}

/** What the IR's order has received so far, its GRN, and why a delivery can't be recorded now, if it can't. */
export async function getOrderReceipt(internalRequisitionId: number) {
  const order = await loadOrder(internalRequisitionId)
  if (!order) throw new NotFoundError("Internal requisition", String(internalRequisitionId))
  const { requisition, purchaseOrder, supplier, lines, note } = order
  return {
    internalRequisitionId: requisition.id,
    internalRequisitionNumber: requisition.internalRequisitionNumber,
    isInternational: requisition.isInternational,
    purchaseOrder: purchaseOrder && { id: purchaseOrder.id, purchaseOrderNumber: purchaseOrder.purchaseOrderNumber, status: purchaseOrder.status },
    supplier,
    lines,
    goodsReceivedNote: note && { id: note.id, grnNumber: note.grnNumber, status: note.status },
    blockedReason: deliveryProblem(order),
  }
}

/** The order's first delivery: makes its GRN, with one line per order line. */
export async function createGoodsReceivedNote({ internalRequisitionId, ...delivery }: CreateGoodsReceivedNoteBody, actor: Actor) {
  const { timezone } = await getSettings()
  const { id } = await db.$transaction(async (tx) => {
    // Locks the IR, so its order can't be cancelled or given another GRN meanwhile.
    await lockRequisition(tx, internalRequisitionId)
    const order = await loadOrder(internalRequisitionId, tx)
    if (!order) throw new BadRequestError(`Internal requisition ${internalRequisitionId} doesn't exist or is deleted`)
    if (order.note) {
      throw new GoodsReceivedNoteSourceError(
        `${order.requisition.internalRequisitionNumber} already has ${order.note.grnNumber}: record the delivery on it`,
      )
    }
    const problem = deliveryProblem(order)
    if (problem) throw new GoodsReceivedNoteSourceError(problem)

    const note = await tx.goodsReceivedNote.create({
      data: { internalRequisitionId, supplierId: order.supplier.id, status: "partiallyCompleted", createdBy: actor.id },
    })
    await tx.goodsReceivedNoteItem.createMany({
      data: order.lines.map((line, index) => ({
        goodsReceivedNoteId: note.id,
        lineNo: index + 1,
        productId: line.productId,
        orderedQuantity: line.orderedQuantity,
        createdBy: actor.id,
      })),
    })
    await recordDelivery(tx, note, order, delivery, timezone, actor)
    return note
  })
  return getGoodsReceivedNote(id)
}

/** A later batch of the order's goods, on its GRN. */
export async function addDelivery(id: number, delivery: DeliveryBody, actor: Actor) {
  const { timezone } = await getSettings()
  await db.$transaction(async (tx) => {
    const note = await lockGoodsReceivedNote(tx, id)
    const order = await orderOf(tx, note)
    const problem = deliveryProblem(order)
    if (problem) throw new GoodsReceivedNoteSourceError(problem)
    await recordDelivery(tx, note, order, delivery, timezone, actor)
  })
  return getGoodsReceivedNote(id)
}

/**
 * Serials for units of a serial-tracked line that arrived without them yet: each becomes a unit in stock (+1 stock in
 * hand), on the oldest delivery that still misses serials for the product.
 */
export async function addSerials(id: number, { productId, units }: AddSerialsBody, actor: Actor) {
  await db.$transaction(async (tx) => {
    const note = await lockGoodsReceivedNote(tx, id)
    const line = await tx.goodsReceivedNoteItem.findFirst({
      where: { goodsReceivedNoteId: id, productId, isDeleted: false },
      select: { product: { select: { sku: true, trackingType: true } } },
    })
    if (!line) throw new BadRequestError(`Product ${productId} isn't on ${note.grnNumber}`)
    if (line.product.trackingType !== "serial") throw new GoodsReceivedNoteSerialsError(`${line.product.sku} isn't tracked by serial number`)

    // What each delivery brought of the product, oldest first, and how many of those already have serials (imported
    // deliveries need none).
    const delivered = await tx.goodsReceivedNoteDeliveryItem.findMany({
      where: { productId, isDeleted: false, delivery: { goodsReceivedNoteId: id, isImported: false, isDeleted: false } },
      select: { quantity: true, delivery: { select: { id: true, deliveryNo: true } } },
      orderBy: { delivery: { deliveryNo: "asc" } },
    })
    const entered = await tx.serialItem.groupBy({
      by: ["goodsReceivedNoteDeliveryId"],
      where: { productId, isDeleted: false, goodsReceivedNoteDelivery: { goodsReceivedNoteId: id } },
      _count: { _all: true },
    })
    const gaps = delivered.map(({ quantity, delivery }) => ({
      delivery,
      missing: quantity - (entered.find((row) => row.goodsReceivedNoteDeliveryId === delivery.id)?._count._all ?? 0),
    }))
    const missing = gaps.reduce((total, gap) => total + gap.missing, 0)
    if (units.length > missing) {
      throw new GoodsReceivedNoteSerialsError(`${line.product.sku}: ${missing} serial(s) still to add, ${units.length} given`)
    }

    await tx.$executeRaw`SELECT 1 FROM "Product" WHERE id = ${productId} FOR UPDATE`
    let rest = units
    for (const { delivery, missing: gap } of gaps) {
      const chunk = rest.slice(0, Math.max(gap, 0))
      rest = rest.slice(chunk.length)
      if (chunk.length === 0) continue
      const remarks = `${note.grnNumber} delivery ${delivery.deliveryNo}`
      await addUnits(tx, productId, chunk, { goodsReceivedNoteDeliveryId: delivery.id, remarks }, actor)
    }
    await changeStock(tx, [{ productId, quantity: units.length }], grnSource(note, "Serial numbers added on the GRN"), actor)
    await refreshStatus(tx, id, actor)
  })
  return getGoodsReceivedNote(id)
}

/**
 * For the IR's and the PO's cancel, in their transaction with the IR row locked: once goods have started to arrive
 * (the order has a GRN) the order can't be cancelled.
 */
export async function assertNoGoodsReceived(tx: Prisma.TransactionClient, internalRequisitionId: number) {
  const received = await tx.goodsReceivedNote.findFirst({
    where: { internalRequisitionId, isDeleted: false },
    select: { grnNumber: true, internalRequisition: { select: { internalRequisitionNumber: true } } },
  })
  if (received) throw new GoodsAlreadyReceivedError(received.internalRequisition.internalRequisitionNumber, received.grnNumber)
}

type Order = NonNullable<Awaited<ReturnType<typeof loadOrder>>>

/**
 * The IR with what a GRN receives against: its order lines (the PO's for a local IR, none until it has one; the IR's
 * for an international one), each with what its GRN has received and what is still outstanding, and the GRN, if it has
 * one. null when the IR doesn't exist or is deleted. Pass `tx` to read inside a transaction.
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
        select: {
          id: true,
          grnNumber: true,
          status: true,
          items: { where: { isDeleted: false }, select: { productId: true, receivedQuantity: true } },
        },
      },
    },
  } satisfies Prisma.InternalRequisitionFindUniqueArgs
  const requisition = tx ? await tx.internalRequisition.findUnique(args) : await db.internalRequisition.findUnique(args)
  if (!requisition || requisition.isDeleted) return null

  const { purchaseOrder } = requisition
  const note = requisition.goodsReceivedNotes[0] ?? null
  const received = new Map((note?.items ?? []).map((item) => [item.productId, item.receivedQuantity]))
  const orderLines = requisition.isInternational ? requisition.items : (purchaseOrder?.items ?? [])
  const lines = orderLines.map(({ productId, product, quantity }) => {
    const receivedQuantity = received.get(productId) ?? 0
    return { productId, product, orderedQuantity: quantity, receivedQuantity, outstandingQuantity: Math.max(0, quantity - receivedQuantity) }
  })
  // The goods come from the PO's supplier, which can differ from the IR's.
  return { requisition, purchaseOrder, supplier: (purchaseOrder ?? requisition).supplier, lines, note }
}

/** Why the order can't receive goods: the IR's or PO's status, or everything has arrived. null when it can. */
function deliveryProblem({ requisition, purchaseOrder, lines, note }: Order) {
  const number = requisition.internalRequisitionNumber
  if (lines.length > 0 && lines.every((line) => line.outstandingQuantity === 0)) return `Everything ordered on ${number} has been received`
  // Once it has a GRN, its source was approved and can no longer be cancelled.
  if (note) return null
  if (requisition.isInternational) {
    return requisition.status === "approved" ? null : `${number} is ${requisition.status}; goods are received on an approved international IR`
  }
  if (!purchaseOrder) return `${number} has no purchase order yet`
  const { purchaseOrderNumber, status } = purchaseOrder
  return status === "approved" ? null : `Purchase order ${purchaseOrderNumber} is ${status}; goods are received on an approved purchase order`
}

/**
 * Saves one delivery on the GRN: its lines (what came, at most what is outstanding), the GRN's received totals,
 * quantity-tracked goods into stock, the PO completed when everything has arrived, and the GRN's status.
 */
async function recordDelivery(
  tx: Prisma.TransactionClient,
  note: { id: number; grnNumber: string },
  order: Order,
  { receivedDate, supplierInvoiceNumber, remarks, items }: DeliveryBody,
  timezone: string,
  actor: Actor,
) {
  const received = items.filter((item) => item.quantity > 0)
  for (const item of received) {
    const line = order.lines.find((orderLine) => orderLine.productId === item.productId)
    if (!line) throw new BadRequestError(`Product ${item.productId} isn't on the order`)
    if (item.quantity > line.outstandingQuantity) {
      throw new GoodsReceivedNoteQuantityError(
        `${line.product.sku}: ${item.quantity} received, but only ${line.outstandingQuantity} still outstanding on the order`,
      )
    }
  }

  const deliveryNo = (await tx.goodsReceivedNoteDelivery.count({ where: { goodsReceivedNoteId: note.id } })) + 1
  const delivery = await tx.goodsReceivedNoteDelivery.create({
    data: {
      goodsReceivedNoteId: note.id,
      deliveryNo,
      receivedDate: receivedDate ?? today(timezone),
      supplierInvoiceNumber,
      remarks,
      createdBy: actor.id,
    },
  })
  // The GRN line of each product (one per product: index "GoodsReceivedNoteItem_product_key").
  const lines = await tx.goodsReceivedNoteItem.findMany({
    where: { goodsReceivedNoteId: note.id, isDeleted: false },
    select: { id: true, productId: true },
  })
  const lineIdOf = (productId: string) => lines.find((line) => line.productId === productId)!.id
  await tx.goodsReceivedNoteDeliveryItem.createMany({
    data: received.map((item) => ({ deliveryId: delivery.id, goodsReceivedNoteItemId: lineIdOf(item.productId), ...item, createdBy: actor.id })),
  })
  const modified = { modifiedBy: actor.id, modifiedAt: new Date() }
  for (const { productId, quantity } of received) {
    await tx.goodsReceivedNoteItem.update({
      where: { id: lineIdOf(productId) },
      data: { receivedQuantity: { increment: quantity }, ...modified },
    })
  }

  const counted = received.filter((item) => order.lines.find((line) => line.productId === item.productId)?.product.trackingType === "quantity")
  await changeStock(tx, counted, grnSource(note, `GRN delivery ${deliveryNo}`), actor)

  const outstandingAfter = order.lines.some((line) => line.outstandingQuantity > (received.find((item) => item.productId === line.productId)?.quantity ?? 0))
  if (!outstandingAfter && order.purchaseOrder) {
    await tx.purchaseOrder.update({ where: { id: order.purchaseOrder.id }, data: { status: "completed", ...modified } })
  }
  await refreshStatus(tx, note.id, actor)
}

/** Sets the GRN's status from its lines and their serials. */
async function refreshStatus(tx: Prisma.TransactionClient, id: number, actor: Actor) {
  const [items, serials, imported] = await Promise.all([
    tx.goodsReceivedNoteItem.findMany({
      where: { goodsReceivedNoteId: id, isDeleted: false },
      select: { productId: true, orderedQuantity: true, receivedQuantity: true, product: { select: { trackingType: true } } },
    }),
    serialCounts(tx, id),
    importedQuantities(tx, id),
  ])
  const missesSerials = items.some(
    (item) =>
      item.product.trackingType === "serial" &&
      item.receivedQuantity - (imported.get(item.productId) ?? 0) > (serials.get(item.productId) ?? 0),
  )
  const status: GoodsReceivedNoteStatus = missesSerials
    ? "needSerialNumbers"
    : items.some((item) => item.receivedQuantity < item.orderedQuantity)
      ? "partiallyCompleted"
      : "completed"
  await tx.goodsReceivedNote.update({ where: { id }, data: { status, modifiedBy: actor.id, modifiedAt: new Date() } })
}

/** Units with serials per product, over the GRN's deliveries. */
async function serialCounts(reader: Prisma.TransactionClient | typeof db, goodsReceivedNoteId: number) {
  const rows = await reader.serialItem.groupBy({
    by: ["productId"],
    where: { isDeleted: false, goodsReceivedNoteDelivery: { goodsReceivedNoteId } },
    _count: { _all: true },
  })
  return new Map(rows.map((row) => [row.productId, row._count._all]))
}

/** What each product received on imported deliveries (recorded in the old system), whose units need no serials. */
async function importedQuantities(reader: Prisma.TransactionClient | typeof db, goodsReceivedNoteId: number) {
  const rows = await reader.goodsReceivedNoteDeliveryItem.groupBy({
    by: ["productId"],
    where: { isDeleted: false, delivery: { goodsReceivedNoteId, isImported: true, isDeleted: false } },
    _sum: { quantity: true },
  })
  return new Map(rows.map((row) => [row.productId, row._sum.quantity ?? 0]))
}

/** The GRN as the source of its stock movements. */
function grnSource(note: { id: number; grnNumber: string }, remarks: string) {
  return { goodsReceivedNoteId: note.id, reference: note.grnNumber, remarks }
}

function lockRequisition(tx: Prisma.TransactionClient, internalRequisitionId: number) {
  return tx.$executeRaw`SELECT 1 FROM "InternalRequisition" WHERE id = ${internalRequisitionId} FOR UPDATE`
}

/** Locks the GRN's IR, then the GRN, and returns the GRN. 404 when it doesn't exist or is deleted. */
async function lockGoodsReceivedNote(tx: Prisma.TransactionClient, id: number) {
  const found = await tx.goodsReceivedNote.findUnique({ where: { id }, select: { internalRequisitionId: true, isDeleted: true } })
  if (!found || found.isDeleted) throw new NotFoundError("GRN", String(id))
  await lockRequisition(tx, found.internalRequisitionId)
  await tx.$executeRaw`SELECT 1 FROM "GoodsReceivedNote" WHERE id = ${id} FOR UPDATE`
  return tx.goodsReceivedNote.findUniqueOrThrow({ where: { id }, select: { id: true, grnNumber: true, internalRequisitionId: true } })
}

/** The order of a GRN that exists; its IR can't be removed (Restrict) or deleted (IRs are cancelled, not deleted). */
async function orderOf(tx: Prisma.TransactionClient, note: { internalRequisitionId: number }) {
  const order = await loadOrder(note.internalRequisitionId, tx)
  if (!order) throw new NotFoundError("Internal requisition", String(note.internalRequisitionId))
  return order
}
