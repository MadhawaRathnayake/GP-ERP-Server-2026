import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { actorOf } from "#security/auth.plugin.js"
import { dropdownUserList } from "#modules/dropdowns/dropdowns.schema.js"
import {
  createDirectInvoiceBody,
  createInvoiceBody,
  invoice,
  invoiceIdParams,
  invoicePage,
  listInvoicesQuery,
  updateInvoiceBody,
} from "./invoices.schema.js"
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
      config: { permission: "INVOICES.CREATE_DIRECT", cache: ["UserDropdown", "User"] },
    },
    () => listSalesManagers(),
  )

  app.get(
    "/:id",
    {
      schema: { params: invoiceIdParams, response: { 200: invoice } },
      config: {
        permission: "INVOICES.VIEW",
        cache: ["Invoice", "InvoiceItem", "Quotation", "QuotationItem", "Customer", "User", "Product", "DeliveryNote"],
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
          "Gives the invoice number, moves the stock in hand to in transit and, for sales and warranty invoices, makes a " +
          "draft delivery note. 409 `INSUFFICIENT_STOCK`.",
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
          "Gives back the stock (finalized only) and the quotation's status before it was invoiced, and cancels the " +
          "delivery note.",
      },
      config: { permission: "INVOICES.CANCEL" },
    },
    (req) => cancelInvoice(req.params.id, actorOf(req)),
  )
}

export default routes
