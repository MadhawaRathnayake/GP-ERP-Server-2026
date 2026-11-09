import {
  Prisma,
  type InvoicePaymentMethod,
  type InvoiceStatus,
  type QuotationType,
  type StockBucket,
} from "#generated/prisma/client.js"
import { db } from "#core/db.js"
import { BadRequestError, NotFoundError } from "#http/errors.js"
import { paginate } from "#http/pagination.js"
import type { Actor } from "#security/auth.plugin.js"
import { dropdownUsers, isDropdownUser } from "#modules/dropdowns/dropdowns.service.js"
import { lineAmounts, quotationTotals, roundMoney, serviceTotals } from "#modules/quotations/quotations.amounts.js"
import type { QuotationItemInput } from "#modules/quotations/quotations.schema.js"
import { getSettings, type Settings } from "#modules/settings/settings.service.js"
import {
  InsufficientStockError,
  InvoiceCancelledError,
  InvoiceExistsError,
  InvoiceNotDraftError,
  QuotationNotConfirmedError,
} from "./invoices.errors.js"
import { contentProblems, paymentProblems, quantitiesByProduct, stockShortages, type StockNeed } from "./invoices.rules.js"
import type { CreateDirectInvoiceBody, CreateInvoiceBody, ListInvoicesQuery, UpdateInvoiceBody } from "./invoices.schema.js"

// An invoice is made as a draft from a confirmed quotation (or, with INVOICES.CREATE_DIRECT, without one). The header
// is the quotation's; the lines start as the quotation's and are priced like quotation lines (quotations.amounts.ts),
// with the current product cost and VAT rate, so the invoice keeps its own prices next to the quotation's. A draft can
// be edited; finalizing numbers it and moves its stock in hand to in transit; cancelling moves it back (finalized only)
// and gives the quotation back the status it had. Nothing can be invoiced beyond the stock in hand. Finalizing a sales
// or warranty invoice also makes its draft delivery note (modules/delivery-notes); cancelling cancels the note.
//
// NOT BUILT YET: delivering a note (the old system's "Delivered" took the stock out of in transit, and changed how a
// cancel gave it back), serial numbers per line, and the troubleshoot/repair status updates. Hook them into
// finalizeInvoice and cancelInvoice when those modules exist.

const summaryInclude = {
  quotation: { select: { id: true, quotationNumber: true } },
  customer: { select: { id: true, code: true, name: true } },
  salesManager: { select: { id: true, name: true } },
} satisfies Prisma.InvoiceInclude

const person = { select: { id: true, name: true } } as const

// The detail also carries what the printed invoice shows, and the quotation's figures to compare the prices with.
const detailInclude = {
  ...summaryInclude,
  customer: {
    select: {
      id: true,
      code: true,
      name: true,
      email: true,
      phones: true,
      houseNumber: true,
      street: true,
      city: true,
      district: true,
      country: true,
      vatNumber: true,
      tinNumber: true,
    },
  },
  items: {
    where: { isDeleted: false },
    orderBy: { lineNo: "asc" },
    include: { product: { select: { sku: true, title: true, description: true, imageUrl: true, warrantyMonths: true } } },
  },
  quotation: {
    select: {
      id: true,
      quotationNumber: true,
      status: true,
      serviceCharge: true,
      grandTotal: true,
      createdAt: true,
      items: {
        where: { isDeleted: false },
        orderBy: { lineNo: "asc" },
        select: { productId: true, quantity: true, unitPrice: true, unitCost: true, discountAmount: true, lineTotal: true },
      },
    },
  },
  deliveryNote: { select: { id: true, deliveryNoteNumber: true, status: true } },
  creator: person,
  finalizer: person,
  canceller: person,
} satisfies Prisma.InvoiceInclude

export function listInvoices({ status, type, customerId, quotationId, ...page }: ListInvoicesQuery) {
  const where: Prisma.InvoiceWhereInput = {
    ...(status && { status }),
    ...(type && { type }),
    ...(customerId && { customerId }),
    ...(quotationId && { quotationId }),
    isDeleted: false,
  }
  return paginate(
    page,
    (args) => db.invoice.findMany({ where, include: summaryInclude, orderBy: { id: "desc" }, ...args }),
    () => db.invoice.count({ where }),
  )
}

export async function getInvoice(id: number) {
  const invoice = await db.invoice.findUnique({ where: { id }, include: detailInclude })
  if (!invoice) throw new NotFoundError("Invoice", String(id))
  return invoice
}

/** The users who can be picked as the sales manager of an invoice made without a quotation (Admin → Dropdowns). */
export const listSalesManagers = () => dropdownUsers("SALES_MANAGER")

export async function createInvoice({ quotationId, items, ...data }: CreateInvoiceBody, actor: Actor) {
  const settings = await getSettings()
  const lines = await buildLines(items, settings.vatRate)
  await assertStock(lines)

  const { id } = await db.$transaction(async (tx) => {
    // Locks the quotation, so two invoices for it can't be made at once (the partial unique index also stops that).
    await tx.$executeRaw`SELECT 1 FROM "Quotation" WHERE id = ${quotationId} FOR UPDATE`
    const quotation = await tx.quotation.findUnique({ where: { id: quotationId } })
    if (!quotation || quotation.isDeleted) throw new NotFoundError("Quotation", String(quotationId))
    const live = await tx.invoice.findFirst({ where: { quotationId, status: { notIn: cancelledStatuses } }, select: { id: true } })
    if (live || quotation.status === "invoiceCreated") throw new InvoiceExistsError(quotationId)
    if (quotation.status !== "paymentConfirmed" && quotation.status !== "creditConfirmed") {
      throw new QuotationNotConfirmedError(quotationId)
    }
    assertRules(quotation.type, lines.length, data.serviceCharge, data.paymentMethod, data.paymentDetails)

    const invoice = await tx.invoice.create({
      data: {
        ...data,
        draftNumber: await nextNumber(tx, "draft", settings, actor),
        quotationId,
        quotationStatusBefore: quotation.status,
        customerId: quotation.customerId,
        salesManagerId: quotation.salesManagerId,
        type: quotation.type,
        repairReceiveNoteId: quotation.repairReceiveNoteId,
        troubleshootId: quotation.troubleshootId,
        oldInvoiceId: quotation.oldInvoiceId,
        oldSerialNumberId: quotation.oldSerialNumberId,
        productModel: quotation.productModel,
        paymentTerms: quotation.paymentTerms,
        deliveryLocation: quotation.deliveryLocation,
        ...pricing(quotation.type, data.serviceCharge, lines, settings.vatRate),
        createdBy: actor.id,
      },
    })
    await tx.invoiceItem.createMany({ data: lines.map((line) => ({ ...line, invoiceId: invoice.id, createdBy: actor.id })) })
    // Locks the quotation (QuotationInvoicedError) until the invoice is cancelled.
    await tx.quotation.update({
      where: { id: quotationId },
      data: { status: "invoiceCreated", modifiedBy: actor.id, modifiedAt: new Date() },
    })
    return invoice
  })
  return getInvoice(id)
}

export async function createDirectInvoice({ items, ...data }: CreateDirectInvoiceBody, actor: Actor) {
  const settings = await getSettings()
  await assertActiveCustomer(data.customerId)
  if (!(await isDropdownUser("SALES_MANAGER", data.salesManagerId))) {
    throw new BadRequestError(`User ${data.salesManagerId} isn't one of the sales managers (Admin → Dropdowns)`)
  }
  const lines = await buildLines(items, settings.vatRate)
  await assertStock(lines)

  const { id } = await db.$transaction(async (tx) => {
    const invoice = await tx.invoice.create({
      data: {
        ...data,
        draftNumber: await nextNumber(tx, "draft", settings, actor),
        ...pricing(data.type, data.serviceCharge, lines, settings.vatRate),
        createdBy: actor.id,
      },
    })
    await tx.invoiceItem.createMany({ data: lines.map((line) => ({ ...line, invoiceId: invoice.id, createdBy: actor.id })) })
    return invoice
  })
  return getInvoice(id)
}

// Drafts only. Sending `items` replaces every line, with the current product cost and VAT rate; a service invoice's
// totals are worked out again whenever its charge is sent.
export async function updateInvoice(id: number, { items, ...data }: UpdateInvoiceBody, actor: Actor) {
  const { vatRate } = await getSettings()
  const lines = items && (await buildLines(items, vatRate))
  if (lines) await assertStock(lines)

  await db.$transaction(async (tx) => {
    // Locks the row, so an edit can't cross a finalize or another edit.
    await tx.$executeRaw`SELECT 1 FROM "Invoice" WHERE id = ${id} FOR UPDATE`
    const before = await tx.invoice.findUnique({
      where: { id },
      select: { status: true, type: true, serviceCharge: true, paymentMethod: true, paymentDetails: true },
    })
    if (!before) throw new NotFoundError("Invoice", String(id))
    if (before.status !== "draft") throw new InvoiceNotDraftError(id)
    const serviceCharge = data.serviceCharge === undefined ? before.serviceCharge : data.serviceCharge
    assertRules(
      before.type,
      lines ? lines.length : await tx.invoiceItem.count({ where: { invoiceId: id, isDeleted: false } }),
      serviceCharge,
      data.paymentMethod === undefined ? before.paymentMethod : data.paymentMethod,
      data.paymentDetails === undefined ? before.paymentDetails : data.paymentDetails,
    )

    const modified = { modifiedBy: actor.id, modifiedAt: new Date() }
    if (lines) {
      await tx.invoiceItem.updateMany({ where: { invoiceId: id, isDeleted: false }, data: { isDeleted: true, ...modified } })
      await tx.invoiceItem.createMany({ data: lines.map((line) => ({ ...line, invoiceId: id, createdBy: actor.id })) })
    }
    const repriced = lines !== undefined || data.serviceCharge !== undefined
    await tx.invoice.update({
      where: { id },
      data: { ...data, ...(repriced && pricing(before.type, serviceCharge, lines ?? [], vatRate)), ...modified },
    })
  })
  return getInvoice(id)
}

/**
 * Gives a draft its invoice number and moves its stock from in hand to in transit. A sales or warranty invoice also
 * gets its draft delivery note (a service invoice has nothing to deliver).
 */
export async function finalizeInvoice(id: number, actor: Actor) {
  const settings = await getSettings()
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Invoice" WHERE id = ${id} FOR UPDATE`
    const invoice = await tx.invoice.findUnique({
      where: { id },
      select: { status: true, type: true, items: { where: { isDeleted: false }, select: { productId: true, quantity: true } } },
    })
    if (!invoice) throw new NotFoundError("Invoice", String(id))
    if (invoice.status !== "draft") throw new InvoiceNotDraftError(id)

    const invoiceNumber = await nextNumber(tx, "final", settings, actor)
    const needs = quantitiesByProduct(invoice.items)
    await lockProducts(tx, needs)
    await assertStock(needs, tx)
    await moveStock(tx, needs, "inHand", "inTransit", invoiceNumber, "Invoice finalized", actor)

    const now = new Date()
    await tx.invoice.update({
      where: { id },
      data: { status: "finalized", invoiceNumber, finalizedBy: actor.id, finalizedAt: now, modifiedBy: actor.id, modifiedAt: now },
    })
    if (invoice.type !== "service") await tx.deliveryNote.create({ data: { invoiceId: id, createdBy: actor.id } })
  })
  return getInvoice(id)
}

// A draft that's cancelled becomes cancelled, a finalized one cancelledAfterFinalized.
const cancelledStatuses: InvoiceStatus[] = ["cancelled", "cancelledAfterFinalized"]

/**
 * Cancels a draft (→ cancelled) or a finalized invoice (→ cancelledAfterFinalized). A finalized one's stock goes back
 * from in transit to in hand, and its delivery note is cancelled. The quotation gets back the status it had before it was invoiced, so it can be invoiced
 * again.
 */
export async function cancelInvoice(id: number, actor: Actor) {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Invoice" WHERE id = ${id} FOR UPDATE`
    const invoice = await tx.invoice.findUnique({
      where: { id },
      select: {
        status: true,
        invoiceNumber: true,
        quotationId: true,
        quotationStatusBefore: true,
        items: { where: { isDeleted: false }, select: { productId: true, quantity: true } },
      },
    })
    if (!invoice) throw new NotFoundError("Invoice", String(id))
    if (cancelledStatuses.includes(invoice.status)) throw new InvoiceCancelledError(id)

    if (invoice.status === "finalized") {
      const needs = quantitiesByProduct(invoice.items)
      await lockProducts(tx, needs)
      await moveStock(tx, needs, "inTransit", "inHand", invoice.invoiceNumber, "Invoice cancelled", actor)
    }
    const now = new Date()
    await tx.deliveryNote.updateMany({
      where: { invoiceId: id, status: { not: "cancelled" } },
      data: { status: "cancelled", modifiedBy: actor.id, modifiedAt: now },
    })
    if (invoice.quotationId !== null && invoice.quotationStatusBefore) {
      await tx.quotation.updateMany({
        where: { id: invoice.quotationId, status: "invoiceCreated" },
        data: { status: invoice.quotationStatusBefore, modifiedBy: actor.id, modifiedAt: now },
      })
    }
    await tx.invoice.update({
      where: { id },
      data: {
        status: invoice.status === "finalized" ? "cancelledAfterFinalized" : "cancelled",
        cancelledBy: actor.id,
        cancelledAt: now,
        modifiedBy: actor.id,
        modifiedAt: now,
      },
    })
  })
  return getInvoice(id)
}

/** Each line with the product's title, price and cost filled in, the VAT rate, and its amounts (as on quotations). */
async function buildLines(items: QuotationItemInput[], vatRate: number) {
  const productIds = [...new Set(items.map((item) => item.productId))]
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, title: true, price: true, cost: true, isDeleted: true },
  })
  const byId = new Map(products.map((product) => [product.id, product]))
  const taxRate = new Prisma.Decimal(vatRate)

  return items.map((item, index) => {
    const lineNo = index + 1
    const product = byId.get(item.productId)
    if (!product || product.isDeleted) throw new BadRequestError(`Line ${lineNo}: product ${item.productId} doesn't exist or is deleted`)
    const linePricing = {
      quantity: item.quantity,
      unitPrice: roundMoney(item.unitPrice ?? product.price),
      discountType: item.discountType,
      discountValue: roundMoney(item.discountValue),
      taxRate,
    }
    const amounts = lineAmounts(linePricing)
    if (amounts.discountAmount.gt(amounts.subtotal)) throw new BadRequestError(`Line ${lineNo}: the discount is more than the line subtotal`)
    return {
      lineNo,
      productId: product.id,
      description: item.description ?? product.title,
      unitCost: product.cost,
      ...linePricing,
      ...amounts,
    }
  })
}

/** The totals, and the service VAT rate: from the service charge on a service invoice, from the lines otherwise. */
function pricing(type: QuotationType, serviceCharge: Prisma.Decimal | null, lines: Parameters<typeof quotationTotals>[0], vatRate: number) {
  if (type === "service" && serviceCharge) {
    const taxRate = new Prisma.Decimal(vatRate)
    return { ...serviceTotals(serviceCharge, taxRate), serviceTaxRate: taxRate }
  }
  return { ...quotationTotals(lines), serviceTaxRate: null }
}

function assertRules(
  type: QuotationType,
  lineCount: number,
  serviceCharge: Prisma.Decimal | null,
  method: InvoicePaymentMethod | null,
  details: string | null,
) {
  const problems = {
    ...contentProblems(type, { lineCount, hasServiceCharge: serviceCharge !== null }),
    ...paymentProblems(type, method, details),
  }
  if (Object.keys(problems).length > 0) throw new BadRequestError(Object.values(problems).join(". "), { fields: problems })
}

/**
 * Refuses (409) when the lines need more of a product than is in hand. Before saving a draft it's an early warning;
 * finalizing checks again inside its transaction (`tx`), with the products locked, and that check is the one that counts.
 */
async function assertStock(lines: readonly StockNeed[], tx?: Prisma.TransactionClient) {
  const needs = quantitiesByProduct(lines)
  if (needs.length === 0) return
  const args = {
    where: { id: { in: needs.map((need) => need.productId) } },
    select: { id: true, sku: true, stockInHand: true },
  } satisfies Prisma.ProductFindManyArgs
  const levels = tx ? await tx.product.findMany(args) : await db.product.findMany(args)
  const shortages = stockShortages(needs, levels)
  if (shortages.length > 0) throw new InsufficientStockError(shortages)
}

/** Locks the products' rows in id order (quantitiesByProduct sorts them), so two invoices can't deadlock. */
async function lockProducts(tx: Prisma.TransactionClient, needs: readonly StockNeed[]) {
  if (needs.length === 0) return
  const ids = needs.map((need) => need.productId)
  await tx.$queryRaw`SELECT id FROM "Product" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`
}

const STOCK_COLUMNS = { inHand: "stockInHand", inTransit: "stockInTransit" } as const

/** Moves each quantity from one stock column to another and records both changes as StockMovement rows. */
async function moveStock(
  tx: Prisma.TransactionClient,
  needs: readonly StockNeed[],
  from: keyof typeof STOCK_COLUMNS,
  to: keyof typeof STOCK_COLUMNS,
  reference: string | null,
  remarks: string,
  actor: Actor,
) {
  for (const { productId, quantity } of needs) {
    const product = await tx.product.update({
      where: { id: productId },
      data: { [STOCK_COLUMNS[from]]: { decrement: quantity }, [STOCK_COLUMNS[to]]: { increment: quantity } },
      select: { stockInHand: true, stockInTransit: true },
    })
    const movement = (bucket: StockBucket & keyof typeof STOCK_COLUMNS, signed: number) => ({
      productId,
      bucket,
      quantity: signed,
      balanceAfter: product[STOCK_COLUMNS[bucket]],
      reference,
      remarks,
      createdBy: actor.id,
    })
    await tx.stockMovement.createMany({ data: [movement(from, -quantity), movement(to, quantity)] })
  }
}

/**
 * The next draft or final invoice number (next_invoice_number(), hand-written SQL), for today in the company timezone
 * and the branch of the actor's role (Role.branchCode). Each branch has its own counter.
 */
async function nextNumber(tx: Prisma.TransactionClient, kind: "draft" | "final", { timezone }: Settings, actor: Actor) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date()) // en-CA gives YYYY-MM-DD
  const { role } = await tx.user.findUniqueOrThrow({ where: { id: actor.id }, select: { role: { select: { branchCode: true } } } })
  const [row] = await tx.$queryRaw<{ number: string }[]>`
    SELECT next_invoice_number(${kind}, ${day}::date, ${role.branchCode}) AS number`
  if (!row) throw new Error("next_invoice_number() returned no row")
  return row.number
}

async function assertActiveCustomer(id: string) {
  const customer = await db.customer.findUnique({ where: { id }, select: { isDeleted: true } })
  if (!customer || customer.isDeleted) throw new BadRequestError(`Customer ${id} doesn't exist or is deleted`)
}
