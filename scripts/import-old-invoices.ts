// `npm run import:old-invoices -- <dir> [--dry-run | --apply]`
// One-off move of the old system's invoices, after `import:old-data` (products, customers) and `import:old-quotations`.
// <dir> holds `bsondump` output (one document per line) of the old collections invoices, users, repairreceivednotes and
// troubleshootings, and the optional user-map.json (see import-old-quotations.ts).
//   no flag    converts everything (reading this database only), writes report-invoices.csv to <dir>
//   --dry-run  also writes the invoices inside a transaction, then rolls it back
//   --apply    the same, and commits
// It only adds rows to Invoice and InvoiceItem (and moves the invoice number counters on, and fills the customers'
// invoice figures), and stops if Invoice already has rows. docs/plans/serial-numbers.md §8.2 rule 6:
// - Every old invoice comes, in date order (ids follow the dates). Finalized and cancelled ones are marked isImported:
//   read only, never cancelled here, no stock moved and no delivery note (the old system did all that). An old draft
//   that wasn't cancelled stays a draft (isImported false), to be finished here.
// - Numbers are kept: GP-123, GPDI-5, 26APR_GP01_27 (a draft keeps its number as draftNumber). The counters behind new
//   numbers (NumberSequence) move past the old ones, so a new invoice never repeats an old number.
// - VAT 18% from 2024-01-08 (when the old system started charging it), 0 before. An "LKR" discount is worked out as the
//   old invoice PDF did (invoicePDFGenerator.js, calculateTotalPrice): per unit (× the quantity) on a line with a
//   warranty text (newWarranty), for the whole line otherwise.
// - The warranty is the line's "10 years" / "5 Years" (newWarranty), else the product's; it ends that long after the
//   invoice date.
// - The creator (uploader) is the sales manager, as on the imported quotations (the old salesManager was empty); an old
//   user with no user here falls back to system@gundapower.com, noted in the report.
// - Serial numbers come with import-old-serials.ts, which needs these invoices.
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { Prisma, type DiscountType, type InvoicePaymentMethod, type InvoiceStatus, type SalesDocumentType } from "#generated/prisma/client.js"
import { db } from "#core/db.js"
import { addMonths } from "#modules/invoices/invoices.rules.js"
import {
  lineAmounts,
  quotationTotals,
  roundMoney,
  serviceTotals,
  type LineAmounts,
  type LinePricing,
} from "#modules/quotations/quotations.amounts.js"

const args = process.argv.slice(2)
const dir = args.find((a) => !a.startsWith("--"))
const mode = args.includes("--apply") ? "apply" : args.includes("--dry-run") ? "dry-run" : "report"
if (!dir) {
  console.error("Usage: npm run import:old-invoices -- <dir> [--dry-run | --apply]")
  process.exit(1)
}

const VAT_FROM = new Date("2024-01-08T00:00:00.000Z")
const VAT_RATE = new Prisma.Decimal(18)
const NO_VAT = new Prisma.Decimal(0)
const FALLBACK_USER_EMAIL = "system@gundapower.com"

type OldNumber = { $numberInt: string } | { $numberDouble: string } | { $numberLong: string }
type OldDate = { $date: string | { $numberLong: string } }
type OldId = { $oid: string }
type OldLine = { sku: string; price?: OldNumber; quantity: OldNumber; discount?: OldNumber | null; discountType?: string; newWarranty?: string }
type OldInvoice = {
  _id: OldId
  invoiceNumber: string
  isDraft: boolean
  cancelled: boolean
  date: OldDate
  dueDate?: OldDate
  customerCode: string
  invoiceType?: string
  paymentMethod?: string
  chequeDetails?: string
  bankName?: string
  paymentTerms?: string
  deliverTo?: string
  transport?: string
  collectionMethod?: string
  delivered?: boolean
  quotationNumber?: string
  troubleshootingRef?: OldId
  rrnRef?: OldId
  serviceCharge?: OldNumber | null
  oldSN?: string
  oldInvoiceNum?: string
  modelType?: string
  itemPreparerName?: string
  reasonForCancel?: string
  uploader: OldId
  finalizedAt?: OldDate
  finalizedBy?: OldId
  cancelledAt?: OldDate
  cancelledBy?: OldId
  createdAt?: OldDate
  updatedAt?: OldDate
  invoiceProducts: OldLine[]
}
type OldUser = { _id: OldId; name?: string; email?: string }

const lines = <T>(file: string) =>
  readFileSync(path.join(dir, file), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T)
const num = (v: OldNumber | null | undefined) => (v ? Number(Object.values(v)[0]) : null)
const decimal = (v: number) => roundMoney(new Prisma.Decimal(v))
const oldDate = (d: OldDate) => new Date(typeof d.$date === "string" ? d.$date : Number(d.$date.$numberLong))
const oidTime = (id: OldId) => new Date(parseInt(id.$oid.slice(0, 8), 16) * 1000)
const text = (v: string | null | undefined) => v?.trim() || null
const letters = (v: string | null | undefined) => (v ?? "").toLowerCase().replace(/[^a-z]/g, "")
const lastDigits = (v: string) => v.replace(/\D/g, "").slice(-9)
// "10 years" → 120, "5 Years" → 60; null when there's none.
const warrantyMonthsOf = (v: string | undefined) => {
  const match = v?.trim().match(/^(\d+)\s*(year|month)s?$/i)
  return match ? Number(match[1]) * (match[2]!.toLowerCase() === "year" ? 12 : 1) : null
}
const csv = (rows: Record<string, unknown>[]) =>
  rows.length === 0
    ? ""
    : [Object.keys(rows[0]!), ...rows.map((r) => Object.values(r))].map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n")

// ─── Lookups ────────────────────────────────────────────────────────────────

const [users, customers, products, quotations] = await Promise.all([
  db.user.findMany({ select: { id: true, name: true, email: true } }),
  db.customer.findMany({ select: { id: true, code: true, phones: true, contactPhones: true } }),
  db.product.findMany({ select: { id: true, sku: true, title: true, cost: true, warrantyMonths: true } }),
  db.quotation.findMany({ select: { id: true, quotationNumber: true } }),
])
const fallbackUser = users.find((u) => u.email.toLowerCase() === FALLBACK_USER_EMAIL)

const userMapFile = path.join(dir, "user-map.json")
const userMap = new Map(
  Object.entries(existsSync(userMapFile) ? (JSON.parse(readFileSync(userMapFile, "utf8")) as Record<string, string>) : {}).map(
    ([old, here]) => [old.trim().toLowerCase(), here.trim().toLowerCase()],
  ),
)
// The same matching as import-old-quotations.ts: email (or user-map.json), then name, then a unique first name.
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
const userOf = (id: OldId | undefined) => (id ? (userIds.get(id.$oid) ?? null) : null)

const customerByCode = new Map(customers.map((c) => [c.code.trim(), c.id]))
const customerByPhone = new Map<string, string[]>()
for (const c of customers) {
  for (const phone of [...c.phones, ...c.contactPhones]) {
    const key = lastDigits(phone)
    if (key.length === 9) customerByPhone.set(key, [...(customerByPhone.get(key) ?? []), c.id])
  }
}
const productBySku = new Map(products.map((p) => [p.sku.trim().toUpperCase(), p]))
const quotationIdByNumber = new Map(quotations.map((q) => [q.quotationNumber, q.id]))
const repairNoteNumbers = new Map(lines<{ _id: OldId; rrnNumber?: string }>("repairreceivednotes.json").map((r) => [r._id.$oid, text(r.rrnNumber)]))
const troubleshootNumbers = new Map(lines<{ _id: OldId; trsfNumber?: string }>("troubleshootings.json").map((t) => [t._id.$oid, text(t.trsfNumber)]))

const PAYMENT_METHODS: Record<string, InvoicePaymentMethod> = { Cash: "cash", Credit: "credit", Cheque: "cheque", "Bank Transfer": "bankTransfer" }

// ─── Convert ────────────────────────────────────────────────────────────────

// Oldest first, so ids follow the dates.
const oldInvoices = lines<OldInvoice>("invoices.json").sort(
  (a, b) =>
    oldDate(a.date).getTime() - oldDate(b.date).getTime() ||
    oidTime(a._id).getTime() - oidTime(b._id).getTime() ||
    a._id.$oid.localeCompare(b._id.$oid),
)

type Line = LinePricing & LineAmounts & { lineNo: number; productId: string; description: string; unitCost: Prisma.Decimal; warrantyMonths: number; warrantyEndsAt: Date | null }
type Converted = { invoice: Prisma.InvoiceCreateManyInput & { id: number }; items: Line[]; oldInvoiceNum: string | null }
const converted: Converted[] = []
const report: Record<string, unknown>[] = []
const unmappedUsers = new Map<string, number>()
const liveQuotations = new Set<number>()

for (const old of oldInvoices) {
  const issues: string[] = []
  const notes: string[] = ["Imported from the old system."]
  const number = old.invoiceNumber.trim()

  let customerId = customerByCode.get(old.customerCode.trim())
  if (!customerId) {
    const byPhone = customerByPhone.get(lastDigits(old.customerCode)) ?? []
    if (byPhone.length === 1) {
      customerId = byPhone[0]
      issues.push(`customer code "${old.customerCode}" is a phone number; matched ${customerId} by phone`)
    }
  }
  if (!customerId) {
    report.push({ invoiceNumber: number, imported: "no", status: "", grandTotal: "", issues: `no customer with code or phone "${old.customerCode}"` })
    continue
  }
  let creator = userOf(old.uploader)
  if (!creator) {
    const name = oldUserNames.get(old.uploader.$oid) ?? old.uploader.$oid
    unmappedUsers.set(name, (unmappedUsers.get(name) ?? 0) + 1)
    creator = fallbackUser?.id ?? null
    issues.push(`creator ${name} isn't a user here; ${fallbackUser ? FALLBACK_USER_EMAIL : "nobody"} instead`)
  }
  if (!creator) {
    report.push({ invoiceNumber: number, imported: "no", status: "", grandTotal: "", issues: issues.join("; ") })
    continue
  }

  const status: InvoiceStatus = old.isDraft ? (old.cancelled ? "cancelled" : "draft") : old.cancelled ? "cancelledAfterFinalized" : "finalized"
  const isFinal = status === "finalized" || status === "cancelledAfterFinalized"
  const date = oldDate(old.date)
  const type: SalesDocumentType = old.invoiceType === "Warranty" ? "warranty" : old.invoiceType === "Service" ? "service" : "sales"
  const taxRate = date >= VAT_FROM ? VAT_RATE : NO_VAT

  // A quotation has at most one invoice that isn't cancelled.
  let quotationId = old.quotationNumber ? (quotationIdByNumber.get(old.quotationNumber.trim()) ?? null) : null
  if (quotationId && status !== "cancelled" && status !== "cancelledAfterFinalized") {
    if (liveQuotations.has(quotationId)) {
      issues.push(`quotation ${old.quotationNumber} already has an invoice; not linked`)
      quotationId = null
    } else liveQuotations.add(quotationId)
  }
  if (old.quotationNumber && !quotationId) notes.push(`Quotation in the old system: ${old.quotationNumber}`)

  const paymentMethod = old.paymentMethod ? (PAYMENT_METHODS[old.paymentMethod] ?? null) : null
  const paymentDetails =
    paymentMethod === "cheque" ? text(old.chequeDetails) : paymentMethod === "bankTransfer" ? text(old.bankName) : null
  if (text(old.itemPreparerName)) notes.push(`Item preparer: ${old.itemPreparerName!.trim()}`)
  if (text(old.transport)) notes.push(`Transport: ${old.transport!.trim()}`)
  if (text(old.collectionMethod)) notes.push(`Collection: ${old.collectionMethod!.trim()}`)
  if (old.delivered) notes.push("Delivered in the old system.")
  if (old.cancelled) notes.push(`Cancelled: ${text(old.reasonForCancel) ?? "no reason given"}`)
  // The references belong to their types only (Invoice_type_fields_check); on a sales invoice they're kept as notes.
  if (type === "sales" && (text(old.oldSN) || text(old.oldInvoiceNum) || text(old.modelType))) {
    notes.push(`Old S/N: ${text(old.oldSN) ?? "-"}, old invoice: ${text(old.oldInvoiceNum) ?? "-"}, model: ${text(old.modelType) ?? "-"}`)
  }

  const items: Line[] = []
  if (type === "service") {
    if (old.invoiceProducts.length) notes.push(`Items received for service: ${old.invoiceProducts.map((l) => `${l.sku} × ${num(l.quantity)}`).join(", ")}`)
  } else {
    for (const [index, line] of old.invoiceProducts.entries()) {
      const product = productBySku.get(line.sku.trim().toUpperCase())
      if (!product) {
        issues.push(`line ${index + 1}: SKU ${line.sku} not found, left out`)
        continue
      }
      const rawQuantity = num(line.quantity) ?? 0
      const quantity = Math.max(1, Math.round(rawQuantity))
      if (quantity !== rawQuantity) issues.push(`line ${index + 1}: quantity ${rawQuantity} → ${quantity}`)
      const unitPrice = decimal(num(line.price) ?? 0)
      const rawDiscount = num(line.discount) ?? 0
      let discountType: DiscountType = !rawDiscount ? "none" : line.discountType === "LKR" ? "fixed" : "percentage"
      let discountValue = discountType === "fixed" && text(line.newWarranty) ? decimal(rawDiscount * quantity) : decimal(rawDiscount)
      const subtotal = unitPrice.times(quantity)
      if ((discountType === "percentage" && discountValue.gt(100)) || (discountType === "fixed" && discountValue.gt(subtotal))) {
        issues.push(`line ${index + 1}: discount ${rawDiscount} ${line.discountType ?? ""} more than the line; set to the whole line`)
        discountType = "percentage"
        discountValue = new Prisma.Decimal(100)
      }
      const pricing = { quantity, unitPrice, discountType, discountValue, taxRate }
      const warrantyMonths = warrantyMonthsOf(line.newWarranty) ?? product.warrantyMonths
      items.push({
        lineNo: items.length + 1,
        productId: product.id,
        description: product.title,
        unitCost: product.cost,
        ...pricing,
        ...lineAmounts(pricing),
        warrantyMonths,
        warrantyEndsAt: isFinal && warrantyMonths > 0 ? addMonths(date, warrantyMonths) : null,
      })
    }
  }

  const serviceCharge = type === "service" ? decimal(num(old.serviceCharge) ?? 0) : null
  const totals = serviceCharge ? { ...serviceTotals(serviceCharge, taxRate), serviceTaxRate: taxRate } : { ...quotationTotals(items), serviceTaxRate: null }
  const createdAt = old.createdAt ? oldDate(old.createdAt) : oidTime(old._id)
  const updatedAt = old.updatedAt ? oldDate(old.updatedAt) : null
  const finalizedAt = isFinal ? (old.finalizedAt ? oldDate(old.finalizedAt) : date) : null
  const cancelledAt = old.cancelled ? (old.cancelledAt ? oldDate(old.cancelledAt) : (updatedAt ?? date)) : null

  converted.push({
    invoice: {
      id: converted.length + 1,
      // A finalized invoice keeps its number; a draft keeps it as its draft number.
      draftNumber: isFinal ? `${number} (imported)` : number,
      invoiceNumber: isFinal ? number : null,
      status,
      quotationId,
      quotationStatusBefore: null,
      customerId,
      salesManagerId: creator,
      type,
      repairReceiveNoteId: type === "service" && old.rrnRef ? (repairNoteNumbers.get(old.rrnRef.$oid) ?? old.rrnRef.$oid) : null,
      troubleshootId: type === "warranty" && old.troubleshootingRef ? (troubleshootNumbers.get(old.troubleshootingRef.$oid) ?? old.troubleshootingRef.$oid) : null,
      oldInvoiceNumber: type !== "sales" ? text(old.oldInvoiceNum) : null,
      oldSerialNumber: type !== "sales" ? text(old.oldSN) : null,
      productModel: type === "warranty" ? text(old.modelType) : null,
      paymentTerms: old.paymentTerms?.trim() === "On Delivery" ? "cashOnDelivery" : null,
      deliveryLocation: text(old.deliverTo),
      paymentMethod,
      paymentDetails,
      dueDate: old.dueDate ? oldDate(old.dueDate) : date,
      serviceCharge,
      ...totals,
      notes: notes.join("\n"),
      finalizedBy: isFinal ? (userOf(old.finalizedBy) ?? creator) : null,
      finalizedAt,
      cancelledBy: old.cancelled ? userOf(old.cancelledBy) : null,
      cancelledAt,
      isImported: status !== "draft",
      createdBy: creator,
      createdAt,
      modifiedAt: updatedAt && updatedAt > createdAt ? updatedAt : null,
      isDeleted: false,
    },
    items,
    oldInvoiceNum: type !== "sales" ? text(old.oldInvoiceNum) : null,
  })
  report.push({ invoiceNumber: number, imported: "yes", status, grandTotal: totals.grandTotal.toFixed(2), issues: issues.join("; ") })
}

// The earlier invoice of a service or warranty invoice, when it's one of these.
const idByNumber = new Map(converted.filter((c) => c.invoice.invoiceNumber).map((c) => [c.invoice.invoiceNumber!, c.invoice.id]))
let linkedOldInvoices = 0
for (const c of converted) {
  const id = c.oldInvoiceNum ? idByNumber.get(c.oldInvoiceNum) : undefined
  if (id && id !== c.invoice.id) {
    c.invoice.oldInvoiceId = id
    linkedOldInvoices++
  }
}

// The counters behind new numbers (next_invoice_number(): invoice.final / invoice.draft per month and branch) move past
// the old system's numbers of the same shape, e.g. 26NOV_GP01_27.
const counters = new Map<string, { code: string; period: string; branch: string; value: number }>()
for (const c of converted) {
  for (const value of [c.invoice.invoiceNumber, c.invoice.status === "draft" || c.invoice.status === "cancelled" ? c.invoice.draftNumber : null]) {
    const match = value?.match(/^(\d{2}[A-Z]{3})_([A-Z0-9]+)_(\d+)(-draft)?$/)
    if (!match) continue
    const [, period, branch, n, draft] = match
    const code = draft ? "invoice.draft" : "invoice.final"
    const key = `${code}|${period}|${branch}`
    counters.set(key, { code, period: period!, branch: branch!, value: Math.max(counters.get(key)?.value ?? 0, Number(n)) })
  }
}

// The customers' invoice figures (Customer.lastInvoiceDate, totalInvoices, isActive under 6 months, isDormant over 18).
const now = new Date()
const customerFigures = new Map<string, { last: Date; total: number }>()
for (const c of converted) {
  if (c.invoice.status !== "finalized") continue
  const at = c.invoice.finalizedAt as Date
  const figures = customerFigures.get(c.invoice.customerId)
  customerFigures.set(c.invoice.customerId, { last: figures && figures.last > at ? figures.last : at, total: (figures?.total ?? 0) + 1 })
}

// ─── Report ─────────────────────────────────────────────────────────────────

writeFileSync(path.join(dir, "report-invoices.csv"), csv(report))
const tally = <T>(rows: T[], pick: (r: T) => unknown) =>
  Object.fromEntries([...rows.reduce((m, r) => m.set(String(pick(r)), (m.get(String(pick(r))) ?? 0) + 1), new Map<string, number>())])
console.log(`Invoices: ${converted.length} of ${oldInvoices.length}, lines: ${converted.reduce((n, c) => n + c.items.length, 0)}`)
console.log("  status:", tally(converted, (c) => c.invoice.status))
console.log("  type:", tally(converted, (c) => c.invoice.type))
console.log("  before VAT (no VAT charged):", oldInvoices.filter((old) => oldDate(old.date) < VAT_FROM).length)
console.log("  linked to an imported quotation:", converted.filter((c) => c.invoice.quotationId).length)
console.log("  linked to their earlier invoice:", linkedOldInvoices)
console.log("  drafts kept open:", converted.filter((c) => c.invoice.status === "draft").map((c) => c.invoice.draftNumber))
console.log("  not imported:", report.filter((r) => r.imported === "no").map((r) => `${r.invoiceNumber}: ${r.issues}`))
console.log("  with issues:", report.filter((r) => r.imported === "yes" && r.issues).length)
console.log("Number counters moved on:", [...counters.values()].length, "e.g.", [...counters.values()].slice(-3))
console.log("Customers whose invoice figures are filled in:", customerFigures.size)
if (unmappedUsers.size) console.log(`Old users with no user here (${FALLBACK_USER_EMAIL} used instead):`, Object.fromEntries(unmappedUsers))
console.log(`Report: ${path.join(dir, "report-invoices.csv")}`)

// ─── Write ──────────────────────────────────────────────────────────────────

class RolledBack extends Error {}

// Rows are written 500 at a time, one insert after another, with progress. One createMany of everything makes Prisma split
// it into parameter-limited queries sent in parallel over the transaction's single connection (pg's "already executing
// a query" warning), and the first --apply stalled there.
const CHUNK = 500
async function insertInChunks<T>(label: string, rows: T[], insert: (data: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await insert(rows.slice(i, i + CHUNK))
    process.stdout.write(`\r  ${label}: ${Math.min(i + CHUNK, rows.length)} of ${rows.length}`)
  }
  if (rows.length) process.stdout.write("\n")
}

if (mode !== "report") {
  try {
    await db.$transaction(
      async (tx) => {
        if ((await tx.invoice.count()) > 0) throw new Error("Invoice already has rows; this script only fills an empty table.")
        await insertInChunks("Invoice", converted.map((c) => c.invoice), (data) => tx.invoice.createMany({ data }))
        let itemId = 0
        const items = converted.flatMap((c) =>
          c.items.map((item) => ({ ...item, id: ++itemId, invoiceId: c.invoice.id, createdBy: c.invoice.createdBy, createdAt: c.invoice.createdAt as Date })),
        )
        await insertInChunks("InvoiceItem", items, (data) => tx.invoiceItem.createMany({ data }))
        await tx.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('"Invoice"', 'id'), ${Math.max(converted.length, 1)}, ${converted.length > 0})`)
        await tx.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('"InvoiceItem"', 'id'), ${Math.max(items.length, 1)}, ${items.length > 0})`)
        for (const { code, period, branch, value } of counters.values()) {
          await tx.$executeRaw`
            INSERT INTO "NumberSequence" ("code", "period", "branch", "value") VALUES (${code}, ${period}, ${branch}, ${value})
            ON CONFLICT ("code", "period", "branch") DO UPDATE SET "value" = GREATEST("NumberSequence"."value", EXCLUDED."value"), "modifiedAt" = now()`
        }
        const day = 24 * 60 * 60 * 1000
        for (const [customerId, { last, total }] of customerFigures) {
          const age = (now.getTime() - last.getTime()) / day
          await tx.customer.update({
            where: { id: customerId },
            data: { lastInvoiceDate: last, totalInvoices: total, isActive: age < 183, isDormant: age > 548 },
          })
        }
        console.log(`Wrote ${converted.length} invoices and ${items.length} lines.`)
        if (mode === "dry-run") throw new RolledBack()
      },
      { maxWait: 60_000, timeout: 30 * 60_000 },
    )
    console.log("Committed.")
  } catch (err) {
    if (!(err instanceof RolledBack)) throw err
    console.log("Dry run: everything was written and then rolled back. Run with --apply to keep it.")
  }
}
await db.$disconnect()
