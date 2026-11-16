import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { actorOf } from "#security/auth.plugin.js"
import { dropdownUserList } from "#modules/dropdowns/dropdowns.schema.js"
import {
  createDirectInvoiceBody,
  createInvoiceBody,
  invoice,
  invoiceIdParams,
  invoicePage,
  invoiceSerialParams,
  listInvoicesQuery,
  scanSerialBody,
  scanSerialResult,
  updateInvoiceBody,
} from "./invoices.schema.js"
import { releaseSerial, scanSerial } from "./invoices.serials.js"
import {
  cancelInvoice,
  createDirectInvoice,
  createInvoice,
  finalizeInvoice,
  getInvoice,
  listInvoices,
  listSalesManagers,
  updateInvoice,
} from "./invoices.service.js"

// Each action has its own route and permission, because each has side effects (numbers, stock, the quotation).
const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/",
    {
      schema: { querystring: listInvoicesQuery, response: { 200: invoicePage } },
      config: { permission: "INVOICES.VIEW", cache: ["Invoice", "Quotation", "Customer", "User"] },
    },
    (req) => listInvoices(req.query),
  )

  // For the sales manager dropdown of an invoice made without a quotation (Admin → Dropdowns).
  app.get(
    "/sales-managers",
    {
      schema: { response: { 200: dropdownUserList } },
      config: { permission: "INVOICES.CREATE_DIRECT", cache: ["UserDropdown", "UserDropdownUser", "UserDropdownRole", "User"] },
    },
    () => listSalesManagers(),
  )

  app.get(
    "/:id",
    {
      schema: { params: invoiceIdParams, response: { 200: invoice } },
      config: {
        permission: "INVOICES.VIEW",
        cache: [
          "Invoice",
          "InvoiceItem",
          "InvoiceSerialItem",
          "SerialItem",
          "SerialItemAccessory",
          "Accessory",
          "Quotation",
          "QuotationItem",
          "Customer",
          "User",
          "Product",
          "DeliveryNote",
        ],
      },
    },
    (req) => getInvoice(req.params.id),
  )

  app.post(
    "/",
    {
      schema: {
        body: createInvoiceBody,
        response: { 201: invoice },
        description:
          "A draft invoice for a payment- or credit-confirmed quotation, which becomes invoiceCreated. 409 " +
          "`INVOICE_EXISTS`, `QUOTATION_NOT_CONFIRMED`, or `INSUFFICIENT_STOCK` (with the lines in `details`).",
      },
      config: { permission: "INVOICES.CREATE" },
    },
    async (req, reply) => reply.status(201).send(await createInvoice(req.body, actorOf(req))),
  )

  app.post(
    "/direct",
    {
      schema: { body: createDirectInvoiceBody, response: { 201: invoice }, description: "A draft invoice without a quotation." },
      config: { permission: "INVOICES.CREATE_DIRECT" },
    },
    async (req, reply) => reply.status(201).send(await createDirectInvoice(req.body, actorOf(req))),
  )

  app.patch(
    "/:id",
    {
      schema: {
        params: invoiceIdParams,
        body: updateInvoiceBody,
        response: { 200: invoice },
        description: "Drafts only (409 `INVOICE_NOT_DRAFT`). `items` replaces every line.",
      },
      config: { permission: "INVOICES.EDIT" },
    },
    (req) => updateInvoice(req.params.id, req.body, actorOf(req)),
  )

  app.post(
    "/:id/finalize",
    {
      schema: {
        params: invoiceIdParams,
        response: { 200: invoice },
        description:
          "Gives the invoice number, takes the stock out of stock in hand, sells the scanned units, starts each line's " +
          "warranty and, for sales and warranty invoices, makes a draft delivery note. 409 `INSUFFICIENT_STOCK`, " +
          "409 `SERIALS_MISSING` (a serial-tracked line without all its units scanned).",
      },
      config: { permission: "INVOICES.FINALIZE" },
    },
    (req) => finalizeInvoice(req.params.id, actorOf(req)),
  )

  app.post(
    "/:id/cancel",
    {
      schema: {
        params: invoiceIdParams,
        response: { 200: invoice },
        description:
          "Gives back the stock and the sold units (finalized only) and the quotation's status before it was invoiced, " +
          "releases the scanned units, and cancels the delivery note.",
      },
      config: { permission: "INVOICES.CANCEL" },
    },
    (req) => cancelInvoice(req.params.id, actorOf(req)),
  )

  app.post(
    "/:id/serials/scan",
    {
      schema: {
        params: invoiceIdParams,
        body: scanSerialBody,
        response: { 200: scanSerialResult },
        description:
          "Drafts only: picks the scanned unit (or a pallet's units) for its line. 404 `SERIAL_NOT_FOUND`, 409 " +
          "`SERIAL_NOT_AVAILABLE` with the reason (another product, already scanned, on another invoice, not in stock, line full).",
      },
      config: { permission: "INVOICES.ADD_SERIALS" },
    },
    (req) => scanSerial(req.params.id, req.body.code, actorOf(req)),
  )

  app.delete(
    "/:id/serials/:serialItemId",
    {
      schema: { params: invoiceSerialParams, description: "Drafts only: takes a scanned unit off (a wrong scan)" },
      config: { permission: "INVOICES.ADD_SERIALS" },
    },
    async (req, reply) => {
      await releaseSerial(req.params.id, req.params.serialItemId, actorOf(req))
      return reply.status(204).send()
    },
  )
}

export default routes
