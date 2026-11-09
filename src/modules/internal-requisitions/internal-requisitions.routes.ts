import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { actorOf } from "#security/auth.plugin.js"
import { rejectBody } from "#modules/approvals/approvals.schema.js"
import {
  cancelInternalRequisitionBody,
  createInternalRequisitionBody,
  internalRequisition,
  internalRequisitionIdParams,
  internalRequisitionPage,
  listInternalRequisitionsQuery,
  updateInternalRequisitionBody,
} from "./internal-requisitions.schema.js"
import {
  approveInternalRequisition,
  cancelInternalRequisition,
  createInternalRequisition,
  getInternalRequisition,
  listInternalRequisitions,
  rejectInternalRequisition,
  updateInternalRequisition,
} from "./internal-requisitions.service.js"

// Each action has its own route and permission (approving and rejecting are separate grants).
const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/",
    {
      schema: { querystring: listInternalRequisitionsQuery, response: { 200: internalRequisitionPage } },
      config: { permission: "INTERNAL_REQUISITIONS.VIEW", cache: ["InternalRequisition", "Supplier", "User"] },
    },
    (req) => listInternalRequisitions(req.query),
  )

  app.get(
    "/:id",
    {
      schema: { params: internalRequisitionIdParams, response: { 200: internalRequisition } },
      config: {
        permission: "INTERNAL_REQUISITIONS.VIEW",
        cache: ["InternalRequisition", "InternalRequisitionItem", "Supplier", "Product", "User", "Approval"],
      },
    },
    (req) => getInternalRequisition(req.params.id),
  )

  app.post(
    "/",
    {
      schema: {
        body: createInternalRequisitionBody,
        response: { 201: internalRequisition },
        description: "Saved as pending, or as approved when internal requisitions don't need approval (Admin → Approvals).",
      },
      config: { permission: "INTERNAL_REQUISITIONS.CREATE" },
    },
    async (req, reply) => reply.status(201).send(await createInternalRequisition(req.body, actorOf(req))),
  )

  app.patch(
    "/:id",
    {
      schema: {
        params: internalRequisitionIdParams,
        body: updateInternalRequisitionBody,
        response: { 200: internalRequisition },
        description:
          "Pending and rejected only (409 `INTERNAL_REQUISITION_NOT_EDITABLE`). `items` replaces every line. Sets the " +
          "status again as on create, so editing a rejected IR submits it again.",
      },
      config: { permission: "INTERNAL_REQUISITIONS.EDIT" },
    },
    (req) => updateInternalRequisition(req.params.id, req.body, actorOf(req)),
  )

  app.post(
    "/:id/approve",
    {
      schema: {
        params: internalRequisitionIdParams,
        response: { 200: internalRequisition },
        description: "Pending only (409 `INTERNAL_REQUISITION_NOT_PENDING`).",
      },
      config: { permission: "INTERNAL_REQUISITIONS.APPROVE" },
    },
    (req) => approveInternalRequisition(req.params.id, actorOf(req)),
  )

  app.post(
    "/:id/reject",
    {
      schema: {
        params: internalRequisitionIdParams,
        body: rejectBody,
        response: { 200: internalRequisition },
        description: "Pending only (409 `INTERNAL_REQUISITION_NOT_PENDING`). It can then be edited and submitted again.",
      },
      config: { permission: "INTERNAL_REQUISITIONS.REJECT" },
    },
    (req) => rejectInternalRequisition(req.params.id, req.body.reason, actorOf(req)),
  )

  app.post(
    "/:id/cancel",
    {
      schema: {
        params: internalRequisitionIdParams,
        body: cancelInternalRequisitionBody,
        response: { 200: internalRequisition },
        description: "An approved IR → cancelledAfterApproved, any other → cancelled. 409 `INTERNAL_REQUISITION_CANCELLED`.",
      },
      config: { permission: "INTERNAL_REQUISITIONS.CANCEL" },
    },
    (req) => cancelInternalRequisition(req.params.id, req.body.reason, actorOf(req)),
  )
}

export default routes
