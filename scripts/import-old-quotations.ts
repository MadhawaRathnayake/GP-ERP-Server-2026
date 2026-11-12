// `npm run import:old-quotations -- <dir> [--dry-run | --apply]`
// One-off move of the old system's quotations, after `import:old-data` has moved products, customers and suppliers.
// <dir> holds `bsondump` output (one document per line) of the old collections quotations, invoices, users,
// repairreceivednotes and troubleshootings. An optional user-map.json there maps old emails to users' emails here, for old
// accounts whose name and email both changed: { "accounts-5@gundapower.com": "system@gundapower.com" }.
//   no flag    converts everything (reading this database only), writes report-quotations.csv to <dir>
//   --dry-run  also writes the quotations inside a transaction, then rolls it back
//   --apply    the same, and commits
// It only adds rows to Quotation and QuotationItem, and stops if Quotation already has rows. Every old quotation is
// imported and none is deleted: the old system's "deleted" meant invoiced or hidden after 3 months, so the status comes
// from its invoice and flags instead. Users are matched by email, then name, then first name (old "Damith" → "Damith
// Hemantha"); the creator becomes the sales manager (the old salesManager was always empty).
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { Prisma, type DiscountType, type QuotationStatus, type QuotationType } from "#generated/prisma/client.js"
import { db } from "#core/db.js"
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
  console.error("Usage: npm run import:old-quotations -- <dir> [--dry-run | --apply]")
  process.exit(1)
}

// The old system charged 18% VAT on every quotation it still has (all from 2026).
const VAT_RATE = new Prisma.Decimal(18)

type OldNumber = { $numberInt: string } | { $numberDouble: string } | { $numberLong: string }
type OldDate = { $date: string | { $numberLong: string } }
type OldId = { $oid: string }
type OldLine = { sku: string; price: OldNumber; specialPrice?: OldNumber | null; quantity: OldNumber; discount?: OldNumber | null; discountType?: string }
type OldQuotation = {
  _id: OldId
  quotationNumber: string
  customerCode: string
  date: OldDate
  quoteType?: "Sales" | "Warranty" | "Service"
  troubleshootingRef?: OldId
  rrnRef?: OldId
  serviceCharge?: OldNumber | null
  oldSN?: string | null
  oldInvoiceNum?: string | null
  modelType?: string | null
  paymentTerms?: string
  deliverTo?: string
  uploader: OldId
  cancelled?: boolean
  reasonForCancel?: string
  paymentReceived?: boolean
  paymentConfirmedBy?: OldId
  creditConfirmation?: boolean
  creditConfirmedBy?: OldId
  preOrder?: boolean
  quotationProducts: OldLine[]
  createdAt?: OldDate
  updatedAt?: OldDate
}
type OldInvoice = { invoiceNumber?: string; quotationNumber?: string; cancelled?: boolean; isDraft?: boolean }
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
const csv = (rows: Record<string, unknown>[]) =>
  rows.length === 0
    ? ""
    : [Object.keys(rows[0]!), ...rows.map((r) => Object.values(r))].map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n")

// ─── Lookups ────────────────────────────────────────────────────────────────

const [users, customers, products] = await Promise.all([
  db.user.findMany({ select: { id: true, name: true, email: true } }),
  db.customer.findMany({ select: { id: true, code: true, phones: true, contactPhones: true } }),
  db.product.findMany({ select: { id: true, sku: true, title: true, cost: true } }),
])

const userMapFile = path.join(dir, "user-map.json")
const userMap = new Map(
  Object.entries(existsSync(userMapFile) ? (JSON.parse(readFileSync(userMapFile, "utf8")) as Record<string, string>) : {}).map(
    ([old, here]) => [old.trim().toLowerCase(), here.trim().toLowerCase()],
  ),
)
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

const customerByCode = new Map(customers.map((c) => [c.code.trim(), c.id]))
const customerByPhone = new Map<string, string[]>()
for (const c of customers) {
  for (const phone of [...c.phones, ...c.contactPhones]) {
    const key = lastDigits(phone)
    if (key.length === 9) customerByPhone.set(key, [...(customerByPhone.get(key) ?? []), c.id])
  }
}
const productBySku = new Map(products.map((p) => [p.sku.trim().toUpperCase(), p]))

// Old invoices name their quotation by number; a quotation turned into an invoice was hidden ("deleted") by the old system.
const invoicesByQuotation = new Map<string, OldInvoice[]>()
for (const invoice of lines<OldInvoice>("invoices.json")) {
  if (invoice.quotationNumber) invoicesByQuotation.set(invoice.quotationNumber, [...(invoicesByQuotation.get(invoice.quotationNumber) ?? []), invoice])
}
const repairNoteNumbers = new Map(lines<{ _id: OldId; rrnNumber?: string }>("repairreceivednotes.json").map((r) => [r._id.$oid, text(r.rrnNumber)]))
const troubleshootNumbers = new Map(lines<{ _id: OldId; trsfNumber?: string }>("troubleshootings.json").map((t) => [t._id.$oid, text(t.trsfNumber)]))

// ─── Convert ────────────────────────────────────────────────────────────────

const report: Record<string, unknown>[] = []
const unmappedUsers = new Map<string, number>()
const countUnmapped = (id: OldId | undefined) => {
  if (id && !userIds.get(id.$oid)) unmappedUsers.set(oldUserNames.get(id.$oid) ?? id.$oid, (unmappedUsers.get(oldUserNames.get(id.$oid) ?? id.$oid) ?? 0) + 1)
}

const oldQuotations = lines<OldQuotation>("quotations.json").sort(
  (a, b) => Number(a.quotationNumber.replace(/\D/g, "")) - Number(b.quotationNumber.replace(/\D/g, "")),
)

type Line = LinePricing & LineAmounts & { lineNo: number; productId: string; description: string; unitCost: Prisma.Decimal }
type Converted = { quotation: Prisma.QuotationCreateManyInput; items: Line[] }
const converted: Converted[] = []

for (const q of oldQuotations) {
  const issues: string[] = []
  const notes: string[] = []

  let customerId = customerByCode.get(q.customerCode.trim())
  if (!customerId) {
    const byPhone = customerByPhone.get(lastDigits(q.customerCode)) ?? []
    if (byPhone.length === 1) {
      customerId = byPhone[0]
      issues.push(`customer code "${q.customerCode}" is a phone number; matched ${customerId} by phone`)
    }
  }
  const salesManagerId = userIds.get(q.uploader.$oid)
  if (!customerId || !salesManagerId) {
    if (!salesManagerId) countUnmapped(q.uploader)
    report.push({
      quotationNumber: q.quotationNumber,
      imported: "no",
      status: "",
      grandTotal: "",
      oldTotal: "",
      issues: !customerId ? `no customer with code or phone "${q.customerCode}"` : `creator ${oldUserNames.get(q.uploader.$oid)} isn't a user here`,
    })
    continue
  }

  // Status: a live invoice → invoiceCreated; otherwise the old flags.
  const invoices = invoicesByQuotation.get(q.quotationNumber) ?? []
  const live = invoices.filter((i) => !i.cancelled)
  let status: QuotationStatus
  if (live.length > 0) status = "invoiceCreated"
  else if (q.cancelled) status = q.paymentReceived ? "cancelledAfterPayment" : q.creditConfirmation ? "cancelledAfterCredit" : "cancelled"
  else if (q.paymentReceived) status = "paymentConfirmed"
  else if (q.creditConfirmation) status = "creditConfirmed"
  else status = "active"
  if (live.length) notes.push(`Invoice in the old system: ${live.map((i) => `${i.invoiceNumber ?? "?"}${i.isDraft ? " (draft)" : ""}`).join(", ")}`)
  const cancelledInvoices = invoices.filter((i) => i.cancelled)
  if (cancelledInvoices.length) notes.push(`Cancelled invoice in the old system: ${cancelledInvoices.map((i) => i.invoiceNumber ?? "?").join(", ")}`)
  if (q.cancelled) notes.push(`Cancelled: ${text(q.reasonForCancel) ?? "no reason given"}`)

  const confirmer = q.paymentReceived ? q.paymentConfirmedBy : q.creditConfirmation ? q.creditConfirmedBy : undefined
  const confirmedById = confirmer ? (userIds.get(confirmer.$oid) ?? null) : null
  if (confirmer && !confirmedById) countUnmapped(confirmer)

  const type: QuotationType = q.quoteType === "Warranty" ? "warranty" : q.quoteType === "Service" ? "service" : "sales"
  if (type === "service") {
    if (text(q.modelType)) notes.push(`Model: ${q.modelType!.trim()}`)
    if (q.quotationProducts.length) {
      notes.push(`Items received for service: ${q.quotationProducts.map((l) => `${l.sku} × ${num(l.quantity)}`).join(", ")}`)
    }
  }

  // Lines (none on a service quotation: its price is the service charge).
  const items: Line[] = []
  if (type !== "service") {
    for (const [index, line] of q.quotationProducts.entries()) {
      const product = productBySku.get(line.sku.trim().toUpperCase())
      if (!product) {
        issues.push(`line ${index + 1}: SKU ${line.sku} not found, left out`)
        continue
      }
      const rawQuantity = num(line.quantity) ?? 0
      const quantity = Math.max(1, Math.round(rawQuantity))
      if (quantity !== rawQuantity) {
        notes.push(`Line ${items.length + 1} (${line.sku}): quantity was ${rawQuantity} in the old system`)
        issues.push(`line ${index + 1}: quantity ${rawQuantity} → ${quantity}`)
      }
      const discount = num(line.discount) ?? 0
      const discountType: DiscountType = !discount ? "none" : line.discountType === "LKR" ? "fixed" : "percentage"
      const pricing = {
        quantity,
        unitPrice: decimal(num(line.specialPrice) ?? num(line.price) ?? 0),
        discountType,
        discountValue: discountType === "none" ? new Prisma.Decimal(0) : decimal(discount),
        taxRate: VAT_RATE,
      }
      items.push({ lineNo: items.length + 1, productId: product.id, description: product.title, unitCost: product.cost, ...pricing, ...lineAmounts(pricing) })
    }
  }

  const serviceCharge = type === "service" ? decimal(num(q.serviceCharge) ?? 0) : null
  const totals = serviceCharge
    ? { ...serviceTotals(serviceCharge, VAT_RATE), serviceTaxRate: VAT_RATE }
    : { ...quotationTotals(items), serviceTaxRate: null }

  // The old PDF: special price if set, discount per line (LKR = whole line), 18% VAT on the total.
  const oldNet =
    type === "service"
      ? (num(q.serviceCharge) ?? 0)
      : q.quotationProducts.reduce((sum, l) => {
          const unit = num(l.specialPrice) ?? num(l.price) ?? 0
          const qty = num(l.quantity) ?? 0
          const off = l.discountType === "LKR" ? (num(l.discount) ?? 0) : (unit * qty * (num(l.discount) ?? 0)) / 100
          return sum + unit * qty - off
        }, 0)
  const oldTotal = Math.round(oldNet * 1.18 * 100) / 100
  if (Math.abs(totals.grandTotal.toNumber() - oldTotal) > 1) issues.push(`total differs from the old PDF by more than 1: old ${oldTotal}`)

  const createdAt = q.createdAt ? oldDate(q.createdAt) : oidTime(q._id)
  const updatedAt = q.updatedAt ? oldDate(q.updatedAt) : null
  converted.push({
    quotation: {
      quotationNumber: q.quotationNumber.trim(),
      customerId,
      salesManagerId,
      quotationDate: oldDate(q.date),
      validUntil: null,
      status,
      ...totals,
      notes: notes.join("\n") || null,
      type,
      repairReceiveNoteId: type === "service" && q.rrnRef ? (repairNoteNumbers.get(q.rrnRef.$oid) ?? q.rrnRef.$oid) : null,
      troubleshootId: type === "warranty" && q.troubleshootingRef ? (troubleshootNumbers.get(q.troubleshootingRef.$oid) ?? q.troubleshootingRef.$oid) : null,
      oldInvoiceId: type !== "sales" ? text(q.oldInvoiceNum) : null,
      oldSerialNumberId: type !== "sales" ? text(q.oldSN) : null,
      productModel: type === "warranty" ? text(q.modelType) : null,
      paymentTerms: q.paymentTerms?.trim() === "On Delivery" ? "cashOnDelivery" : null,
      deliveryLocation: text(q.deliverTo),
      isPreOrdered: type === "sales" && q.preOrder === true,
      confirmedById,
      createdBy: salesManagerId,
      createdAt,
      modifiedAt: updatedAt && updatedAt > createdAt ? updatedAt : null,
      isDeleted: false,
    },
    items,
  })
  report.push({ quotationNumber: q.quotationNumber, imported: "yes", status, grandTotal: totals.grandTotal.toFixed(2), oldTotal: oldTotal.toFixed(2), issues: issues.join("; ") })
}

// ─── Report ─────────────────────────────────────────────────────────────────

writeFileSync(path.join(dir, "report-quotations.csv"), csv(report))
const tally = <T>(rows: T[], pick: (r: T) => unknown) =>
  Object.fromEntries([...rows.reduce((m, r) => m.set(String(pick(r)), (m.get(String(pick(r))) ?? 0) + 1), new Map<string, number>())])
console.log("Old users matched:", Object.fromEntries([...userIds].filter(([, id]) => id).map(([old, id]) => [oldUserNames.get(old), id])))
console.log(`Quotations: ${converted.length} of ${oldQuotations.length}, lines: ${converted.reduce((n, c) => n + c.items.length, 0)}`)
console.log("  status:", tally(converted, (c) => c.quotation.status))
console.log("  type:", tally(converted, (c) => c.quotation.type))
console.log("  confirmed with a confirmer:", converted.filter((c) => c.quotation.confirmedById).length)
console.log("  not imported:", report.filter((r) => r.imported === "no").map((r) => `${r.quotationNumber}: ${r.issues}`))
console.log("  with issues:", report.filter((r) => r.imported === "yes" && r.issues).length)
if (unmappedUsers.size) console.log("Old users with no user here (create them and run again to fill these in):", Object.fromEntries(unmappedUsers))
console.log(`Report: ${path.join(dir, "report-quotations.csv")}`)

// ─── Write ──────────────────────────────────────────────────────────────────

class RolledBack extends Error {}

if (mode !== "report") {
  try {
    await db.$transaction(
      async (tx) => {
        if ((await tx.quotation.count()) > 0) throw new Error("Quotation already has rows; this script only fills an empty table.")
        const quotations = converted.map((c, i) => ({ ...c.quotation, id: i + 1 }))
        let itemId = 0
        const items = converted.flatMap((c, i) => c.items.map((item) => ({ ...item, id: ++itemId, quotationId: i + 1, createdBy: c.quotation.createdBy, createdAt: c.quotation.createdAt })))
        await tx.quotation.createMany({ data: quotations })
        await tx.quotationItem.createMany({ data: items })
        await tx.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('"Quotation"', 'id'), ${Math.max(quotations.length, 1)}, ${quotations.length > 0})`)
        await tx.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('"QuotationItem"', 'id'), ${Math.max(items.length, 1)}, ${items.length > 0})`)
        // New quotations continue after the old system's last number.
        const lastOld = Math.max(0, ...quotations.map((q) => Number(q.quotationNumber!.replace(/\D/g, ""))))
        await tx.$executeRawUnsafe(`SELECT setval('quotation_number_seq', ${Math.max(lastOld, 1)}, ${lastOld > 0})`)
        console.log(`Wrote ${quotations.length} quotations and ${items.length} lines; the next new quotation number follows GPQ-${lastOld}.`)
        if (mode === "dry-run") throw new RolledBack()
      },
      { maxWait: 60_000, timeout: 15 * 60_000 },
    )
    console.log("Committed.")
  } catch (err) {
    if (!(err instanceof RolledBack)) throw err
    console.log("Dry run: everything was written and then rolled back. Run with --apply to keep it.")
  }
}
await db.$disconnect()
