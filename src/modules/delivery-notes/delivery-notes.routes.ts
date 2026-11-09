import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { actorOf } from "#security/auth.plugin.js"
import { dropdownUserList } from "#modules/dropdowns/dropdowns.schema.js"
import {
  deliveryNote,
  deliveryNoteIdParams,
  deliveryNotePage,
  listDeliveryNotesQuery,
  setItemIssuerBody,
  setItemVerifierBody,
} from "./delivery-notes.schema.js"
import {
  getDeliveryNote,
  listDeliveryNotes,
  listItemIssuers,
  listItemVerifiers,
  setItemIssuer,
  setItemVerifier,
} from "./delivery-notes.service.js"

// Notes are made and cancelled by their invoice (finalize / cancel), so there's no create or delete here.
const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/",
    {
      schema: { querystring: listDeliveryNotesQuery, response: { 200: deliveryNotePage } },
      config: { permission: "DELIVERY_NOTES.VIEW", cache: ["DeliveryNote", "Invoice", "Customer", "User"] },
    },
    (req) => listDeliveryNotes(req.query),
  )

  // For the item verifier and item issuer dropdowns (Admin → Dropdowns).
  app.get(
    "/item-verifiers",
    {
      schema: { response: { 200: dropdownUserList } },
      config: { permission: "DELIVERY_NOTES.SET_VERIFIER", cache: ["UserDropdown", "User"] },
    },
    () => listItemVerifiers(),
  )

  app.get(
    "/item-issuers",
    {
      schema: { response: { 200: dropdownUserList } },
      config: { permission: "DELIVERY_NOTES.SET_ISSUER", cache: ["UserDropdown", "User"] },
    },
    () => listItemIssuers(),
  )

  app.get(
    "/:id",
    {
      schema: { params: deliveryNoteIdParams, response: { 200: deliveryNote } },
      config: {
        permission: "DELIVERY_NOTES.VIEW",
        cache: ["DeliveryNote", "Invoice", "InvoiceItem", "Customer", "User", "Product"],
      },
    },
    (req) => getDeliveryNote(req.params.id),
  )

  app.post(
    "/:id/verifier",
    {
      schema: {
        params: deliveryNoteIdParams,
        body: setItemVerifierBody,
        response: { 200: deliveryNote },
        description: "Sets or changes the item verifier. Drafts only (409 `DELIVERY_NOTE_NOT_DRAFT`).",
      },
      config: { permission: "DELIVERY_NOTES.SET_VERIFIER" },
    },
    (req) => setItemVerifier(req.params.id, req.body.userId, actorOf(req)),
  )

  app.post(
    "/:id/issuer",
    {
      schema: {
        params: deliveryNoteIdParams,
        body: setItemIssuerBody,
        response: { 200: deliveryNote },
        description:
          "Adds the item issuer and issues the note. 409 `DELIVERY_NOTE_NOT_DRAFT`, `ITEM_VERIFIER_REQUIRED` or " +
          "`SAME_VERIFIER_AND_ISSUER`.",
      },
      config: { permission: "DELIVERY_NOTES.SET_ISSUER" },
    },
    (req) => setItemIssuer(req.params.id, req.body.userId, actorOf(req)),
  )
}

export default routes
