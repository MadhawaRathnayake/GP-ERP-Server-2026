import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { actorOf } from "#security/auth.plugin.js"
import {
  addSerialsBody,
  createGoodsReceivedNoteBody,
  deliveryBody,
  goodsReceivedNote,
  goodsReceivedNoteIdParams,
  goodsReceivedNotePage,
  listGoodsReceivedNotesQuery,
  orderParams,
  orderReceipt,
} from "./goods-received-notes.schema.js"
import {
  addDelivery,
  addSerials,
  createGoodsReceivedNote,
  getGoodsReceivedNote,
  getOrderReceipt,
  listGoodsReceivedNotes,
} from "./goods-received-notes.service.js"

const detailTables = [
  "GoodsReceivedNote",
  "GoodsReceivedNoteItem",
  "GoodsReceivedNoteDelivery",
  "GoodsReceivedNoteDeliveryItem",
  "SerialItem",
  "InternalRequisition",
  "PurchaseOrder",
  "Supplier",
  "Product",
  "User",
]

// No approval: a delivery puts its goods in stock when it is saved; serials are added as the last step.
const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/",
    {
      schema: { querystring: listGoodsReceivedNotesQuery, response: { 200: goodsReceivedNotePage } },
      config: {
        permission: "GOODS_RECEIVED_NOTES.VIEW",
        cache: ["GoodsReceivedNote", "GoodsReceivedNoteDelivery", "InternalRequisition", "PurchaseOrder", "Supplier", "User"],
      },
    },
    (req) => listGoodsReceivedNotes(req.query),
  )

  app.get(
    "/orders/:internalRequisitionId",
    {
      schema: {
        description: "What an order (an IR, with its PO when local) has received so far, its GRN, and whether a delivery can be recorded",
        params: orderParams,
        response: { 200: orderReceipt },
      },
      config: {
        permission: "GOODS_RECEIVED_NOTES.VIEW",
        cache: [
          "GoodsReceivedNote",
          "GoodsReceivedNoteItem",
          "InternalRequisition",
          "InternalRequisitionItem",
          "PurchaseOrder",
          "PurchaseOrderItem",
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
      config: { permission: "GOODS_RECEIVED_NOTES.VIEW", cache: detailTables },
    },
    (req) => getGoodsReceivedNote(req.params.id),
  )

  app.post(
    "/",
    {
      schema: {
        description: "Records an order's first delivery, which makes its GRN. Later deliveries: POST /:id/deliveries",
        body: createGoodsReceivedNoteBody,
        response: { 201: goodsReceivedNote },
      },
      config: { permission: "GOODS_RECEIVED_NOTES.CREATE" },
    },
    async (req, reply) => reply.status(201).send(await createGoodsReceivedNote(req.body, actorOf(req))),
  )

  app.post(
    "/:id/deliveries",
    {
      schema: {
        description: "Records another delivery of the order's goods",
        params: goodsReceivedNoteIdParams,
        body: deliveryBody,
        response: { 200: goodsReceivedNote },
      },
      config: { permission: "GOODS_RECEIVED_NOTES.CREATE" },
    },
    (req) => addDelivery(req.params.id, req.body, actorOf(req)),
  )

  app.post(
    "/:id/serials",
    {
      schema: {
        description: "Adds serials for units of a serial-tracked line; each unit goes into stock",
        params: goodsReceivedNoteIdParams,
        body: addSerialsBody,
        response: { 200: goodsReceivedNote },
      },
      config: { permission: "GOODS_RECEIVED_NOTES.ADD_SERIALS" },
    },
    (req) => addSerials(req.params.id, req.body, actorOf(req)),
  )
}

export default routes
