import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { actorOf } from "#security/auth.plugin.js"
import { rejectBody } from "#modules/approvals/approvals.schema.js"
import {
  cancelPurchaseOrderBody,
  createPurchaseOrderBody,
  listPurchaseOrdersQuery,
  purchaseOrder,
  purchaseOrderIdParams,
  purchaseOrderPage,
  updatePurchaseOrderBody,
} from "./purchase-orders.schema.js"
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  createPurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrders,
  rejectPurchaseOrder,
  updatePurchaseOrder,
} from "./purchase-orders.service.js"

// Each action has its own route and permission (approving and rejecting are separate grants).
const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/",
    {
      schema: { querystring: listPurchaseOrdersQuery, response: { 200: purchaseOrderPage } },
      config: { permission: "PURCHASE_ORDERS.VIEW", cache: ["PurchaseOrder", "InternalRequisition", "Supplier", "User"] },
    },
    (req) => listPurchaseOrders(req.query),
  )

  app.get(
    "/:id",
    {
      schema: { params: purchaseOrderIdParams, response: { 200: purchaseOrder } },
      config: {
        permission: "PURCHASE_ORDERS.VIEW",
        cache: ["PurchaseOrder", "PurchaseOrderItem", "InternalRequisition", "Supplier", "Product", "User", "Approval"],
      },
    },
    (req) => getPurchaseOrder(req.params.id),
  )

  app.post(
    "/",
    {
      schema: {
        body: createPurchaseOrderBody,
        response: { 201: purchaseOrder },
        description:
          "From a local internal requisition with no PO (409 `PURCHASE_ORDER_SOURCE` otherwise). A pending IR is " +
          "approved by this save, which also needs `INTERNAL_REQUISITIONS.APPROVE` (403). Saved as pending, or as approved " +
          "when purchase orders don't need approval (Admin → Approvals).",
      },
      config: { permission: "PURCHASE_ORDERS.CREATE" },
    },
    async (req, reply) => reply.status(201).send(await createPurchaseOrder(req.body, actorOf(req), req.user.permissions)),
  )

  app.patch(
    "/:id",
    {
      schema: {
        params: purchaseOrderIdParams,
        body: updatePurchaseOrderBody,
        response: { 200: purchaseOrder },
        description:
          "Pending and rejected only (409 `PURCHASE_ORDER_NOT_EDITABLE`). `items` replaces every line. Sets the status " +
          "again as on create, so editing a rejected PO submits it again.",
      },
      config: { permission: "PURCHASE_ORDERS.EDIT" },
    },
    (req) => updatePurchaseOrder(req.params.id, req.body, actorOf(req)),
  )

  app.post(
    "/:id/approve",
    {
      schema: {
        params: purchaseOrderIdParams,
        response: { 200: purchaseOrder },
        description: "Pending only (409 `PURCHASE_ORDER_NOT_PENDING`).",
      },
      config: { permission: "PURCHASE_ORDERS.APPROVE" },
    },
    (req) => approvePurchaseOrder(req.params.id, actorOf(req)),
  )

  app.post(
    "/:id/reject",
    {
      schema: {
        params: purchaseOrderIdParams,
        body: rejectBody,
        response: { 200: purchaseOrder },
        description: "Pending only (409 `PURCHASE_ORDER_NOT_PENDING`). It can then be edited and submitted again.",
      },
      config: { permission: "PURCHASE_ORDERS.REJECT" },
    },
    (req) => rejectPurchaseOrder(req.params.id, req.body.reason, actorOf(req)),
  )

  app.post(
    "/:id/cancel",
    {
      schema: {
        params: purchaseOrderIdParams,
        body: cancelPurchaseOrderBody,
        response: { 200: purchaseOrder },
        description:
          "An approved PO → cancelledAfterApproved, a pending or rejected one → cancelled; its internal requisition is " +
          "cancelled too, with the same reason. 409 `PURCHASE_ORDER_NOT_CANCELLABLE` when completed or already cancelled.",
      },
      config: { permission: "PURCHASE_ORDERS.CANCEL" },
    },
    (req) => cancelPurchaseOrder(req.params.id, req.body.reason, actorOf(req)),
  )
}

export default routes
