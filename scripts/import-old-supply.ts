// `npm run import:old-supply -- <dir> [--dry-run | --apply]`
// One-off move of the old system's internal requisitions, purchase orders and GRNs, after `import:old-data` (products,
// suppliers). <dir> holds `bsondump` output (one document per line) of the old collections internalrequisitions,
// purchaseorders, grns and users, and the optional user-map.json (see import-old-quotations.ts).
//   no flag    converts everything (reading this database only), writes report-supply.csv to <dir>
//   --dry-run  also writes them inside a transaction, then rolls it back
//   --apply    the same, and commits
// It only adds rows to InternalRequisition(Item), PurchaseOrder(Item), GoodsReceivedNote(Item), GoodsReceivedNoteDelivery
// (Item) and Approval, and moves the GPIR- / GPPO- / GPGRN- number counters on. It never moves stock: the old system
// already did. It stops if any of those tables already has rows.
// - Numbers are kept (GPIR-0001, GPPO-0001, GPGRN-0001); ids follow them.
// - IR: pending → pending; poApproved / grnCreated → approved; cancelled → cancelled, or cancelledAfterApproved when it
//   had a purchase order. International when the old IR says so (older ones: when it has no PO). Its lines keep the
//   old "available qty" as stockInHand; minimumStock is the product's.
// - PO: approved → approved; grnCreated → completed when everything arrived, else approved; cancelled → cancelled
//   (cancelledAfterApproved when it had been approved). VAT 18% on the discounted subtotal, as the old PO did.
// - Approvals: a local IR was approved by whoever made its PO, then; a PO by its approvedBy. An international IR had no
//   approval in the old system: an automatic one (by its preparer) is written.
// - GRNs: the new system has one GRN per order, received in deliveries. The old GRNs of one IR become one GRN (the first
//   one's number) with a delivery each, marked isImported: already in stock, so their units aren't asked for serials.
//   Its status is worked out as the GRN service does: partiallyCompleted while something ordered hasn't arrived.
// - An old GRN made without an IR or PO gets an approved international IR of its own (numbered after the old IRs),
//   holding the GRN's lines, as the owner chose. Its lines' stockInHand is 0 (not known).
// - A GRN line for a product that isn't on the order, where one order line of the same quantity never arrived, is taken
//   as that line's product having been swapped (the old GRN edited it): the order line gets the product received.
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { Prisma, type DiscountType, type InternalRequisitionStatus, type PurchaseOrderStatus } from "#generated/prisma/client.js"
import { db } from "#core/db.js"
import { lineAmounts, quotationTotals, roundMoney } from "#modules/quotations/quotations.amounts.js"

const args = process.argv.slice(2)
const dir = args.find((a) => !a.startsWith("--"))
const mode = args.includes("--apply") ? "apply" : args.includes("--dry-run") ? "dry-run" : "report"
if (!dir) {
  console.error("Usage: npm run import:old-supply -- <dir> [--dry-run | --apply]")
  process.exit(1)
}

const VAT_FROM = new Date("2024-01-08T00:00:00.000Z")
const FALLBACK_USER_EMAIL = "system@gundapower.com"

type OldNumber = { $numberInt: string } | { $numberDouble: string } | { $numberLong: string }
type OldDate = { $date: string | { $numberLong: string } }
type OldId = { $oid: string }
type OldRequisition = {
  _id: OldId
  irNumber: string
  status: string
  supplierCode: string
  eta?: OldDate
  international?: boolean
  products: { itemCode: string; orderQty: OldNumber; availableQty?: OldNumber }[]
  preparedBy?: OldId
  createdAt: OldDate
  updatedAt?: OldDate
  cancelledBy?: OldId | string
  reasonForCancel?: string
}
type OldPurchaseOrder = {
  _id: OldId
  poNumber: string
  irNumber: string
  status: string
  cancelled?: boolean
  supplierCode: string
  date: OldDate
  comments?: string
  remarks?: string
  poProducts: { itemCode: string; quantity: OldNumber; unitPrice: OldNumber; discount?: OldNumber | null; discountType?: string }[]
  uploader?: OldId
  createdAt: OldDate
  updatedAt?: OldDate
  approvedAt?: OldDate
  approvedBy?: OldId
  cancelledAt?: OldDate
  cancelledBy?: OldId
  reasonForCancel?: string
}
type OldGrn = {
  _id: OldId
  grnNumber: string
  status: string
  date: OldDate
  supplierCode: string
  poNumber?: string
  irNumber?: string
  supplierInvoiceNumber?: string
  products: { itemCode: string; orderQty: OldNumber; deliveredQty?: OldNumber; remarks?: string }[]
  preparedBy?: OldId
  createdAt: OldDate
  updatedAt?: OldDate
}
type OldUser = { _id: OldId; name?: string; email?: string }

const lines = <T>(file: string) =>
  readFileSync(path.join(dir, file), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T)
const num = (v: OldNumber | null | undefined) => (v ? Number(Object.values(v)[0]) : 0)
const oldDate = (d: OldDate) => new Date(typeof d.$date === "string" ? d.$date : Number(d.$date.$numberLong))
const text = (v: string | null | undefined) => v?.trim() || null
const letters = (v: string | null | undefined) => (v ?? "").toLowerCase().replace(/[^a-z]/g, "")
const numberOf = (v: string) => Number(v.replace(/\D/g, ""))
const byNumber = <T>(pick: (row: T) => string) => (a: T, b: T) => numberOf(pick(a)) - numberOf(pick(b))
const csv = (rows: Record<string, unknown>[]) =>
  rows.length === 0
    ? ""
    : [Object.keys(rows[0]!), ...rows.map((r) => Object.values(r))].map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n")

// ─── Lookups ────────────────────────────────────────────────────────────────

// The company timezone, read directly: getSettings() goes through the Redis cache, which would keep this script running.
const timezone = (await db.setting.findUnique({ where: { id: 1 }, select: { timezone: true } }))?.timezone ?? "Asia/Colombo"
// The day in the company timezone, as a @db.Date value.
const dayOf = (date: Date) => new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(date)}T00:00:00.000Z`)

const [users, products, suppliers] = await Promise.all([
  db.user.findMany({ select: { id: true, name: true, email: true } }),
  db.product.findMany({ select: { id: true, sku: true, minimumStock: true, trackingType: true } }),
  db.supplier.findMany({ select: { id: true, code: true } }),
])
const fallbackUser = users.find((u) => u.email.toLowerCase() === FALLBACK_USER_EMAIL)

const userMapFile = path.join(dir, "user-map.json")
const userMap = new Map(
  Object.entries(existsSync(userMapFile) ? (JSON.parse(readFileSync(userMapFile, "utf8")) as Record<string, string>) : {}).map(
    ([old, here]) => [old.trim().toLowerCase(), here.trim().toLowerCase()],
  ),
)
// The same matching as import-old-invoices.ts: email (or user-map.json), then name, then a unique first name; an old
// user with no user here falls back to system@gundapower.com, noted in the output.
const userIds = new Map<string, string | null>()
for (const old of lines<OldUser>("users.json")) {
  const email = old.email?.trim().toLowerCase()
  const mappedEmail = email && userMap.get(email)
  const firstName = letters(old.name?.trim().split(/\s+/)[0])
  const byFirstName = users.filter((u) => letters(u.name.split(/\s+/)[0]) === firstName)
  const match =
    users.find((u) => mappedEmail && u.email.toLowerCase() === mappedEmail) ??
    users.find((u) => email && u.email.toLowerCase() === email) ??
    users.find((u) => letters(u.name) === letters(old.name)) ??
    (letters(old.name) === firstName && byFirstName.length === 1 ? byFirstName[0] : undefined)
  userIds.set(old._id.$oid, match?.id ?? null)
}
const oldUserNames = new Map(lines<OldUser>("users.json").map((u) => [u._id.$oid, `${u.name ?? "?"} <${u.email ?? "?"}>`]))
const unmappedUsers = new Map<string, number>()
const userOf = (id: OldId | string | undefined) => {
  if (!id) return null
  const key = typeof id === "string" ? id : id.$oid
  const found = userIds.get(key)
  if (found) return found
  const name = oldUserNames.get(key) ?? key
  unmappedUsers.set(name, (unmappedUsers.get(name) ?? 0) + 1)
  return fallbackUser?.id ?? null
}

const productBySku = new Map(products.map((p) => [p.sku.trim().toUpperCase(), p]))
const productOf = (sku: string) => productBySku.get(sku.trim().toUpperCase())
const supplierByCode = new Map(suppliers.map((s) => [s.code.trim(), s.id]))

// ─── Convert ────────────────────────────────────────────────────────────────

const oldRequisitions = lines<OldRequisition>("internalrequisitions.json").sort(byNumber((r) => r.irNumber))
const oldOrders = lines<OldPurchaseOrder>("purchaseorders.json").sort(byNumber((p) => p.poNumber))
const oldGrns = lines<OldGrn>("grns.json").sort(byNumber((g) => g.grnNumber))
const orderOfIr = new Map(oldOrders.map((p) => [p.irNumber, p]))

type Line = { productId: string; quantity: number }
type Requisition = {
  row: Prisma.InternalRequisitionCreateManyInput & { id: number; internalRequisitionNumber: string; supplierId: string; isInternational: boolean }
  items: (Prisma.InternalRequisitionItemCreateManyInput & Line)[]
  old: OldRequisition | null
}
type Order = { row: Prisma.PurchaseOrderCreateManyInput & { id: number; status: PurchaseOrderStatus; supplierId: string }; items: (Prisma.PurchaseOrderItemCreateManyInput & Line)[] }

const report: Record<string, unknown>[] = []
const note = (kind: string, number: string, status: string, imported: string, issues: string[]) =>
  report.push({ kind, number, status, imported, issues: issues.join("; ") })

const requisitions: Requisition[] = []
const orders: Order[] = []
const approvals: Prisma.ApprovalCreateManyInput[] = []
const requisitionByNumber = new Map<string, Requisition>()
const orderByIr = new Map<string, Order>()

const requisitionLines = (
  products: { itemCode: string; orderQty: OldNumber; availableQty?: OldNumber }[],
  createdBy: string | null,
  createdAt: Date,
  issues: string[],
) =>
  products.flatMap((old) => {
    const product = productOf(old.itemCode)
    if (!product) return issues.push(`no product ${old.itemCode}: line left out`), []
    if (num(old.orderQty) < 1) return issues.push(`${old.itemCode}: quantity ${num(old.orderQty)}, line left out`), []
    return [{ productId: product.id, quantity: num(old.orderQty), stockInHand: Math.trunc(num(old.availableQty)), minimumStock: product.minimumStock, createdBy, createdAt }]
  })

// Requisitions, in number order (ids follow).
for (const old of oldRequisitions) {
  const issues: string[] = []
  const supplierId = supplierByCode.get(old.supplierCode?.trim())
  const po = orderOfIr.get(old.irNumber)
  if (!supplierId) {
    note("IR", old.irNumber, old.status, "no", [`no supplier ${old.supplierCode}`])
    continue
  }
  let isInternational = old.international ?? !po
  if (isInternational && po) {
    issues.push(`marked international but has ${po.poNumber}: imported as local`)
    isInternational = false
  }
  const createdBy = userOf(old.preparedBy)
  const createdAt = oldDate(old.createdAt)
  const items = requisitionLines(old.products, createdBy, createdAt, issues)
  if (items.length === 0) {
    note("IR", old.irNumber, old.status, "no", [...issues, "no lines"])
    continue
  }
  const STATUS: Record<string, InternalRequisitionStatus> = { pending: "pending", poApproved: "approved", grnCreated: "approved", poCreated: "approved" }
  const cancelled = old.status === "cancelled"
  const status: InternalRequisitionStatus = cancelled ? (po ? "cancelledAfterApproved" : "cancelled") : (STATUS[old.status] ?? "pending")
  if (!cancelled && !STATUS[old.status]) issues.push(`unknown status ${old.status}: imported as pending`)
  const updatedAt = old.updatedAt ? oldDate(old.updatedAt) : null
  const requisition: Requisition = {
    old,
    row: {
      id: requisitions.length + 1,
      internalRequisitionNumber: old.irNumber,
      supplierId,
      status,
      isInternational,
      eta: old.eta ? dayOf(oldDate(old.eta)) : null,
      cancelReason: cancelled ? (text(old.reasonForCancel) ?? "Cancelled in the old system") : null,
      cancelledBy: cancelled ? userOf(old.cancelledBy) : null,
      cancelledAt: cancelled ? (updatedAt ?? createdAt) : null,
      createdBy,
      createdAt,
      modifiedAt: updatedAt && updatedAt.getTime() - createdAt.getTime() > 1000 ? updatedAt : null,
    },
    items: items.map((item, index) => ({ ...item, lineNo: index + 1, internalRequisitionId: 0 })),
  }
  requisitions.push(requisition)
  requisitionByNumber.set(old.irNumber, requisition)
  if ((status === "approved" || status === "cancelledAfterApproved") && isInternational) {
    approvals.push({ screen: "INTERNAL_REQUISITIONS", documentId: requisition.row.id, decision: "approved", isAutomatic: true, createdBy, createdAt })
  }
  note("IR", old.irNumber, `${old.status} → ${status}${isInternational ? " (international)" : ""}`, "yes", issues)
}

// Purchase orders, in number order (ids follow); the status of one with goods is set with its GRN below.
for (const old of oldOrders) {
  const issues: string[] = []
  const requisition = requisitionByNumber.get(old.irNumber)
  const supplierId = supplierByCode.get(old.supplierCode?.trim())
  if (!requisition || !supplierId) {
    note("PO", old.poNumber, old.status, "no", [!requisition ? `its IR ${old.irNumber} wasn't imported` : `no supplier ${old.supplierCode}`])
    continue
  }
  const date = oldDate(old.date)
  const taxRate = new Prisma.Decimal(date >= VAT_FROM ? 18 : 0)
  const createdBy = userOf(old.uploader)
  const createdAt = oldDate(old.createdAt)
  const items = old.poProducts.flatMap((line) => {
    const product = productOf(line.itemCode)
    if (!product) return issues.push(`no product ${line.itemCode}: line left out`), []
    const unitPrice = roundMoney(new Prisma.Decimal(num(line.unitPrice)))
    if (num(line.quantity) < 1 || unitPrice.lte(0)) return issues.push(`${line.itemCode}: quantity ${num(line.quantity)}, price ${unitPrice}: line left out`), []
    const discount = num(line.discount)
    const discountType: DiscountType = discount <= 0 ? "none" : line.discountType === "LKR" ? "fixed" : "percentage"
    const pricing = { quantity: num(line.quantity), unitPrice, discountType, discountValue: roundMoney(new Prisma.Decimal(discountType === "none" ? 0 : discount)), taxRate }
    return [{ productId: product.id, ...pricing, ...lineAmounts(pricing), createdBy, createdAt }]
  })
  if (items.length === 0) {
    note("PO", old.poNumber, old.status, "no", [...issues, "no lines"])
    continue
  }
  const cancelled = old.status === "cancelled" || old.cancelled
  const status: PurchaseOrderStatus = cancelled ? (old.approvedAt ? "cancelledAfterApproved" : "cancelled") : old.status === "pending" ? "pending" : "approved"
  const order: Order = {
    row: {
      id: orders.length + 1,
      purchaseOrderNumber: old.poNumber,
      internalRequisitionId: requisition.row.id,
      supplierId,
      purchaseOrderDate: dayOf(date),
      status,
      comments: text(old.comments),
      remarks: text(old.remarks),
      ...quotationTotals(items),
      cancelReason: cancelled ? (text(old.reasonForCancel) ?? "Cancelled in the old system") : null,
      cancelledBy: cancelled ? userOf(old.cancelledBy) : null,
      cancelledAt: cancelled ? (old.cancelledAt ? oldDate(old.cancelledAt) : old.updatedAt ? oldDate(old.updatedAt) : createdAt) : null,
      createdBy,
      createdAt,
      modifiedAt: old.updatedAt && oldDate(old.updatedAt).getTime() - createdAt.getTime() > 1000 ? oldDate(old.updatedAt) : null,
    },
    items: items.map((item, index) => ({ ...item, lineNo: index + 1, purchaseOrderId: 0 })),
  }
  orders.push(order)
  orderByIr.set(old.irNumber, order)
  // Making the PO approved its IR (purchase-orders.service.ts, createPurchaseOrder).
  if (requisition.row.status !== "pending") {
    approvals.push({ screen: "INTERNAL_REQUISITIONS", documentId: requisition.row.id, decision: "approved", createdBy, createdAt })
  }
  if (old.approvedAt) {
    approvals.push({ screen: "PURCHASE_ORDERS", documentId: order.row.id, decision: "approved", createdBy: userOf(old.approvedBy), createdAt: oldDate(old.approvedAt) })
  }
  note("PO", old.poNumber, `${old.status} → ${status}`, "yes", issues)
}

// An IR for each old GRN made without an order, numbered after the old IRs.
const grnsByIr = new Map<string, OldGrn[]>()
let lastIrNumber = Math.max(0, ...requisitions.map((r) => numberOf(r.row.internalRequisitionNumber)))
const madeRequisitions: string[] = []
for (const grn of oldGrns) {
  if (text(grn.irNumber)) {
    grnsByIr.set(grn.irNumber!, [...(grnsByIr.get(grn.irNumber!) ?? []), grn])
    continue
  }
  const issues: string[] = []
  const supplierId = supplierByCode.get(grn.supplierCode?.trim())
  const createdBy = userOf(grn.preparedBy)
  const createdAt = oldDate(grn.createdAt)
  const items = requisitionLines(grn.products, createdBy, createdAt, issues).map((item) => ({ ...item, stockInHand: 0 }))
  if (!supplierId || items.length === 0) {
    note("GRN", grn.grnNumber, grn.status, "no", [...issues, !supplierId ? `no supplier ${grn.supplierCode}` : "no lines"])
    continue
  }
  const number = `GPIR-${String(++lastIrNumber).padStart(4, "0")}`
  const requisition: Requisition = {
    old: null,
    row: { id: requisitions.length + 1, internalRequisitionNumber: number, supplierId, status: "approved", isInternational: true, createdBy, createdAt },
    items: items.map((item, index) => ({ ...item, lineNo: index + 1, internalRequisitionId: 0 })),
  }
  requisitions.push(requisition)
  requisitionByNumber.set(number, requisition)
  approvals.push({ screen: "INTERNAL_REQUISITIONS", documentId: requisition.row.id, decision: "approved", isAutomatic: true, createdBy, createdAt })
  grnsByIr.set(number, [grn])
  madeRequisitions.push(`${number} for ${grn.grnNumber}`)
  note("IR", number, "made → approved (international)", "new", [`made for ${grn.grnNumber}, which had no IR or PO`, ...issues])
}

// GRNs: one per IR, a delivery per old GRN, in the order of the first old GRN's number.
type Grn = {
  row: Prisma.GoodsReceivedNoteCreateManyInput & { id: number }
  items: Prisma.GoodsReceivedNoteItemCreateManyInput[]
  deliveries: { row: Prisma.GoodsReceivedNoteDeliveryCreateManyInput & { id: number }; items: Prisma.GoodsReceivedNoteDeliveryItemCreateManyInput[] }[]
}
const grns: Grn[] = []
let deliveryId = 0
const swaps: string[] = []
for (const [irNumber, olds] of [...grnsByIr].sort((a, b) => numberOf(a[1][0]!.grnNumber) - numberOf(b[1][0]!.grnNumber))) {
  const first = olds[0]!
  const issues: string[] = []
  const requisition = requisitionByNumber.get(irNumber)
  const order = orderByIr.get(irNumber)
  if (!requisition || (!requisition.row.isInternational && !order)) {
    for (const old of olds) note("GRN", old.grnNumber, old.status, "no", [!requisition ? `its IR ${irNumber} wasn't imported` : `${irNumber} has no imported PO`])
    continue
  }
  // The order's lines: the PO's (local) or the IR's (international).
  const orderLines: Line[] = requisition.row.isInternational ? requisition.items : order!.items

  // What arrived, per product, over the old GRNs; and their lines' order quantity.
  const received = new Map<string, number>()
  const grnLineQuantity = new Map<string, number>()
  for (const old of olds) {
    for (const line of old.products) {
      const product = productOf(line.itemCode)
      if (!product) {
        issues.push(`${old.grnNumber}: no product ${line.itemCode}, line left out`)
        continue
      }
      received.set(product.id, (received.get(product.id) ?? 0) + num(line.deliveredQty))
      grnLineQuantity.set(product.id, num(line.orderQty))
    }
  }
  // A product received that isn't on the order, where an order line of the same quantity got nothing: swapped.
  for (const [productId, quantity] of grnLineQuantity) {
    if (orderLines.some((line) => line.productId === productId)) continue
    const candidates = orderLines.filter((line) => !grnLineQuantity.has(line.productId) && line.quantity === quantity)
    const sku = (id: string) => products.find((p) => p.id === id)?.sku ?? id
    if (candidates.length === 1) {
      const line = candidates[0]!
      swaps.push(`${irNumber}: ${sku(line.productId)} → ${sku(productId)}`)
      issues.push(`order line ${sku(line.productId)} × ${quantity} received as ${sku(productId)}: the order line now has ${sku(productId)}`)
      line.productId = productId
    } else {
      issues.push(`${sku(productId)} received but not on the order: added as a line of ${quantity}`)
      orderLines.push({ productId, quantity })
    }
  }

  const createdBy = userOf(first.preparedBy)
  const createdAt = oldDate(first.createdAt)
  const lastUpdate = olds.map((old) => (old.updatedAt ? oldDate(old.updatedAt) : oldDate(old.createdAt))).sort((a, b) => b.getTime() - a.getTime())[0]!
  const grn: Grn = {
    row: {
      id: grns.length + 1,
      grnNumber: first.grnNumber,
      internalRequisitionId: requisition.row.id,
      supplierId: order?.row.supplierId ?? requisition.row.supplierId,
      status: orderLines.some((line) => (received.get(line.productId) ?? 0) < line.quantity) ? "partiallyCompleted" : "completed",
      createdBy,
      createdAt,
      modifiedAt: lastUpdate.getTime() - createdAt.getTime() > 1000 ? lastUpdate : null,
    },
    items: orderLines.map((line, index) => ({
      goodsReceivedNoteId: 0,
      lineNo: index + 1,
      productId: line.productId,
      orderedQuantity: line.quantity,
      receivedQuantity: received.get(line.productId) ?? 0,
      createdBy,
      createdAt,
    })),
    deliveries: [],
  }
  for (const old of olds) {
    const items = old.products.flatMap((line) => {
      const product = productOf(line.itemCode)
      return product && num(line.deliveredQty) > 0 ? [{ deliveryId: 0, goodsReceivedNoteItemId: 0, productId: product.id, quantity: num(line.deliveredQty), remarks: text(line.remarks), createdBy: userOf(old.preparedBy), createdAt: oldDate(old.createdAt) }] : []
    })
    if (items.length === 0) {
      issues.push(`${old.grnNumber}: nothing delivered, no delivery made`)
      continue
    }
    grn.deliveries.push({
      row: {
        id: ++deliveryId,
        goodsReceivedNoteId: grn.row.id,
        deliveryNo: grn.deliveries.length + 1,
        receivedDate: dayOf(oldDate(old.date)),
        supplierInvoiceNumber: text(old.supplierInvoiceNumber),
        isImported: true,
        createdBy: userOf(old.preparedBy),
        createdAt: oldDate(old.createdAt),
      },
      items,
    })
    if (old.supplierCode && supplierByCode.get(old.supplierCode.trim()) !== grn.row.supplierId) issues.push(`${old.grnNumber}: supplier ${old.supplierCode} isn't the order's`)
  }
  if (grn.deliveries.length === 0) {
    for (const old of olds) note("GRN", old.grnNumber, old.status, "no", [...issues, "nothing delivered"])
    continue
  }
  const over = grn.items.filter((item) => item.receivedQuantity! > item.orderedQuantity)
  if (over.length) issues.push(`received more than ordered: ${over.map((i) => `${products.find((p) => p.id === i.productId)?.sku} ${i.receivedQuantity} of ${i.orderedQuantity}`).join(", ")}`)
  grns.push(grn)
  // A PO whose goods have all arrived is completed.
  if (order && order.row.status === "approved" && grn.row.status === "completed") order.row.status = "completed"
  olds.forEach((old, index) =>
    note("GRN", old.grnNumber, `${old.status} → ${grn.row.status}`, "yes", index === 0 ? issues : [`delivery ${index + 1} of ${first.grnNumber} (${irNumber})`]),
  )
}

const lastPoNumber = Math.max(0, ...orders.map((o) => numberOf(o.row.purchaseOrderNumber!)))
const lastGrnNumber = Math.max(0, ...oldGrns.map((g) => numberOf(g.grnNumber)))

writeFileSync(path.join(dir, "report-supply.csv"), csv(report))
const tally = <T>(rows: T[], pick: (r: T) => unknown) =>
  Object.fromEntries([...rows.reduce((m, r) => m.set(String(pick(r)), (m.get(String(pick(r))) ?? 0) + 1), new Map<string, number>())])
console.log(`Internal requisitions: ${requisitions.length} (${oldRequisitions.length} old, ${madeRequisitions.length} made for GRNs with no order)`)
console.log("  status:", tally(requisitions, (r) => `${r.row.status}${r.row.isInternational ? " international" : ""}`))
console.log(`Purchase orders: ${orders.length} of ${oldOrders.length}`, tally(orders, (o) => o.row.status))
console.log(`GRNs: ${grns.length} from ${oldGrns.length} old GRNs, ${grns.reduce((n, g) => n + g.deliveries.length, 0)} deliveries`, tally(grns, (g) => g.row.status))
console.log("  with more than one delivery:", grns.filter((g) => g.deliveries.length > 1).map((g) => `${g.row.grnNumber} (${g.deliveries.length})`))
console.log("  order lines swapped to the product received:", swaps)
console.log("  IRs made for GRNs with no order:", madeRequisitions.length, madeRequisitions.slice(0, 3), "…")
console.log("Approvals:", approvals.length)
console.log("Not imported:", report.filter((r) => r.imported === "no").map((r) => `${r.kind} ${r.number}: ${r.issues}`))
console.log("With issues:", report.filter((r) => r.imported !== "no" && r.issues).map((r) => `${r.kind} ${r.number}: ${r.issues}`))
if (unmappedUsers.size) console.log(`Old users with no user here (${FALLBACK_USER_EMAIL} used instead):`, Object.fromEntries(unmappedUsers))
console.log(`New numbers start at GPIR-${String(lastIrNumber + 1).padStart(4, "0")}, GPPO-${String(lastPoNumber + 1).padStart(4, "0")}, GPGRN-${String(lastGrnNumber + 1).padStart(4, "0")}`)
console.log(`Report: ${path.join(dir, "report-supply.csv")}`)

// ─── Write ──────────────────────────────────────────────────────────────────

class RolledBack extends Error {}

if (mode !== "report") {
  try {
    await db.$transaction(
      async (tx) => {
        const existing = await Promise.all([tx.internalRequisition.count(), tx.purchaseOrder.count(), tx.goodsReceivedNote.count(), tx.approval.count()])
        if (existing.some((n) => n > 0)) throw new Error("Internal requisitions, purchase orders, GRNs or approvals already have rows; this script only fills empty tables.")
        await tx.internalRequisition.createMany({ data: requisitions.map((r) => r.row) })
        await tx.internalRequisitionItem.createMany({ data: requisitions.flatMap((r) => r.items.map((item) => ({ ...item, internalRequisitionId: r.row.id }))) })
        await tx.purchaseOrder.createMany({ data: orders.map((o) => o.row) })
        await tx.purchaseOrderItem.createMany({ data: orders.flatMap((o) => o.items.map((item) => ({ ...item, purchaseOrderId: o.row.id }))) })
        await tx.goodsReceivedNote.createMany({ data: grns.map((g) => g.row) })
        await tx.goodsReceivedNoteItem.createMany({ data: grns.flatMap((g) => g.items.map((item) => ({ ...item, goodsReceivedNoteId: g.row.id }))) })
        await tx.goodsReceivedNoteDelivery.createMany({ data: grns.flatMap((g) => g.deliveries.map((d) => d.row)) })
        // Each delivery item is on its GRN's line of the product (one per product).
        const lines = await tx.goodsReceivedNoteItem.findMany({ select: { id: true, goodsReceivedNoteId: true, productId: true } })
        const lineIds = new Map(lines.map((line) => [`${line.goodsReceivedNoteId} ${line.productId}`, line.id]))
        await tx.goodsReceivedNoteDeliveryItem.createMany({
          data: grns.flatMap((g) =>
            g.deliveries.flatMap((d) =>
              d.items.map((item) => ({ ...item, deliveryId: d.row.id, goodsReceivedNoteItemId: lineIds.get(`${g.row.id} ${item.productId}`)! })),
            ),
          ),
        })
        await tx.approval.createMany({ data: approvals.sort((a, b) => (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime()) })
        for (const [sequence, value] of [
          ["internal_requisition_number_seq", lastIrNumber],
          ["purchase_order_number_seq", lastPoNumber],
          ["grn_number_seq", lastGrnNumber],
        ] as const) {
          await tx.$executeRawUnsafe(`SELECT setval('${sequence}', ${Math.max(value, 1)}, ${value > 0})`)
        }
        for (const [table, count] of [
          ["InternalRequisition", requisitions.length],
          ["PurchaseOrder", orders.length],
          ["GoodsReceivedNote", grns.length],
          ["GoodsReceivedNoteDelivery", deliveryId],
        ] as const) {
          await tx.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), ${Math.max(count, 1)}, ${count > 0})`)
        }
        console.log(`Wrote ${requisitions.length} IRs, ${orders.length} POs, ${grns.length} GRNs and ${approvals.length} approvals.`)
        if (mode === "dry-run") throw new RolledBack()
      },
      { maxWait: 60_000, timeout: 10 * 60_000 },
    )
    console.log("Committed.")
  } catch (err) {
    if (!(err instanceof RolledBack)) throw err
    console.log("Dry run: everything was written and then rolled back. Run with --apply to keep it.")
  }
}
await db.$disconnect()
