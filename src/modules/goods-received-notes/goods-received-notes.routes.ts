import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { actorOf } from "#security/auth.plugin.js"
import { rejectBody } from "#modules/approvals/approvals.schema.js"
import {
  cancelGoodsReceivedNoteBody,
  createGoodsReceivedNoteBody,
  goodsReceivedNote,
  goodsReceivedNoteIdParams,
  goodsReceivedNotePage,
  listGoodsReceivedNotesQuery,
  orderParams,
  orderReceipt,
  updateGoodsReceivedNoteBody,
} from "./goods-received-notes.schema.js"
import {
  approveGoodsReceivedNote,
  cancelGoodsReceivedNote,
  createGoodsReceivedNote,
  getGoodsReceivedNote,
  getOrderReceipt,
  listGoodsReceivedNotes,
  rejectGoodsReceivedNote,
  updateGoodsReceivedNote,
} from "./goods-received-notes.service.js"

// Each action has its own route and permission (approving and rejecting are separate grants).
const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/",
    {
      schema: { querystring: listGoodsReceivedNotesQuery, response: { 200: goodsReceivedNotePage } },
      config: {
        permission: "GOODS_RECEIVED_NOTES.VIEW",
        cache: ["GoodsReceivedNote", "InternalRequisition", "PurchaseOrder", "Supplier", "User"],
      },
    },
    (req) => listGoodsReceivedNotes(req.query),
  )

  app.get(
    "/orders/:internalRequisitionId",
    {
      schema: {
        params: orderParams,
        response: { 200: orderReceipt },
        description:
          "What an internal requisition's order (its purchase order, or the IR itself when international) has received " +
          "on approved GRNs, what is outstanding, its GRNs, and `blockedReason`: why a GRN can't be made now (null when it can).",
      },
      config: {
        permission: "GOODS_RECEIVED_NOTES.VIEW",
        cache: [
          "InternalRequisition",
          "InternalRequisitionItem",
          "PurchaseOrder",
          "PurchaseOrderItem",
          "GoodsReceivedNote",
          "GoodsReceivedNoteItem",
          "Supplier",
          "Product",
        ],
      },
    },
    (req) => getOrderReceipt(req.params.internalRequisitionId),
  )

  app.get(
    "/:id",
    {
      schema: { params: goodsReceivedNoteIdParams, response: { 200: goodsReceivedNote } },
      config: {
        permission: "GOODS_RECEIVED_NOTES.VIEW",
        cache: ["GoodsReceivedNote", "GoodsReceivedNoteItem", "InternalRequisition", "PurchaseOrder", "Supplier", "Product", "User", "Approval"],
      },
    },
    (req) => getGoodsReceivedNote(req.params.id),
  )

  app.post(
    "/",
    {
      schema: {
        body: createGoodsReceivedNoteBody,
        response: { 201: goodsReceivedNote },
        description:
          "From a local internal requisition whose purchase order is approved, or an approved international one, with " +
          "something outstanding and no open GRN (409 `GOODS_RECEIVED_NOTE_SOURCE` otherwise). `items` has one line per " +
          "product of the order; a quantity above what's outstanding is 409 `GOODS_RECEIVED_NOTE_QUANTITY`. Saved as " +
          "pending, or as approved (the goods go into stock) when GRNs don't need approval (Admin → Approvals).",
      },
      config: { permission: "GOODS_RECEIVED_NOTES.CREATE" },
    },
    async (req, reply) => reply.status(201).send(await createGoodsReceivedNote(req.body, actorOf(req))),
  )

  app.patch(
    "/:id",
    {
      schema: {
        params: goodsReceivedNoteIdParams,
        body: updateGoodsReceivedNoteBody,
        response: { 200: goodsReceivedNote },
        description:
          "Pending and rejected only (409 `GOODS_RECEIVED_NOTE_NOT_EDITABLE`). `items` replaces every line. Sets the " +
          "status again as on create, so editing a rejected GRN submits it again.",
      },
      config: { permission: "GOODS_RECEIVED_NOTES.EDIT" },
    },
    (req) => updateGoodsReceivedNote(req.params.id, req.body, actorOf(req)),
  )

  app.post(
    "/:id/approve",
    {
      schema: {
        params: goodsReceivedNoteIdParams,
        response: { 200: goodsReceivedNote },
        description:
          "Pending only (409 `GOODS_RECEIVED_NOTE_NOT_PENDING`). Adds the received quantities to stock in hand, and " +
          "completes the purchase order once the order is received in full.",
      },
      config: { permission: "GOODS_RECEIVED_NOTES.APPROVE" },
    },
    (req) => approveGoodsReceivedNote(req.params.id, actorOf(req)),
  )

  app.post(
    "/:id/reject",
    {
      schema: {
        params: goodsReceivedNoteIdParams,
        body: rejectBody,
        response: { 200: goodsReceivedNote },
        description: "Pending only (409 `GOODS_RECEIVED_NOTE_NOT_PENDING`). It can then be edited and submitted again.",
      },
      config: { permission: "GOODS_RECEIVED_NOTES.REJECT" },
    },
    (req) => rejectGoodsReceivedNote(req.params.id, req.body.reason, actorOf(req)),
  )

  app.post(
    "/:id/cancel",
    {
      schema: {
        params: goodsReceivedNoteIdParams,
        body: cancelGoodsReceivedNoteBody,
        response: { 200: goodsReceivedNote },
        description: "Pending and rejected only (409 `GOODS_RECEIVED_NOTE_NOT_CANCELLABLE`): nothing has gone into stock yet.",
      },
      config: { permission: "GOODS_RECEIVED_NOTES.CANCEL" },
    },
    (req) => cancelGoodsReceivedNote(req.params.id, req.body.reason, actorOf(req)),
  )
}

export default routes
