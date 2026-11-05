import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { actorOf } from "#security/auth.plugin.js"
import { dropdownUserList } from "#modules/dropdowns/dropdowns.schema.js"
import { createQuotationBody, listQuotationsQuery, quotation, quotationIdParams, quotationPage, updateQuotationBody } from "./quotations.schema.js"
import {
  createQuotation,
  deleteQuotation,
  getQuotation,
  listQuotations,
  listSalesManagers,
  updateQuotation,
} from "./quotations.service.js"

const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/",
    {
      schema: { querystring: listQuotationsQuery, response: { 200: quotationPage } },
      config: { permission: "QUOTATIONS.VIEW", cache: ["Quotation", "Customer", "User"] },
    },
    (req) => listQuotations(req.query),
  )

  // For the sales manager dropdown; which users it offers is set in Admin → Dropdowns.
  app.get(
    "/sales-managers",
    {
      schema: { response: { 200: dropdownUserList } },
      config: { permission: "QUOTATIONS.VIEW", cache: ["UserDropdown", "User"] },
    },
    () => listSalesManagers(),
  )

  app.get(
    "/:id",
    {
      schema: { params: quotationIdParams, response: { 200: quotation } },
      config: {
        permission: "QUOTATIONS.VIEW",
        cache: ["Quotation", "QuotationItem", "Customer", "User", "Product"],
      },
    },
    (req) => getQuotation(req.params.id),
  )

  app.post(
    "/",
    {
      schema: { body: createQuotationBody, response: { 201: quotation } },
      config: { permission: "QUOTATIONS.CREATE" },
    },
    async (req, reply) => reply.status(201).send(await createQuotation(req.body, actorOf(req))),
  )

  app.patch(
    "/:id",
    {
      schema: {
        params: quotationIdParams,
        body: updateQuotationBody,
        response: { 200: quotation },
        description:
          "Each change also needs its own permission: details or lines `QUOTATIONS.EDIT`; status `CONFIRM_PAYMENT`, " +
          "`CONFIRM_CREDIT`, `CANCEL`, `REOPEN`, `UNDO_CONFIRMATION` (leaving a confirmed status, or reopening one " +
          "cancelled after it); `isDeleted` `DELETE` / `RESTORE`. Without one: 403.",
      },
      // The real check is per change, in the service (quotations.permissions.ts).
      config: { permission: "QUOTATIONS.VIEW" },
    },
    (req) => updateQuotation(req.params.id, req.body, actorOf(req), req.user.permissions),
  )

  app.delete(
    "/:id",
    {
      schema: { params: quotationIdParams },
      config: { permission: "QUOTATIONS.DELETE" },
    },
    async (req, reply) => {
      await deleteQuotation(req.params.id, actorOf(req))
      return reply.status(204).send()
    },
  )
}

export default routes
