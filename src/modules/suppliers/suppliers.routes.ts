import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { createSupplierBody, listSuppliersQuery, supplier, supplierIdParams, supplierIdsQuery, supplierList, supplierPage, updateSupplierBody } from "./suppliers.schema.js";
import { createSupplier, deleteSupplier, getSupplier, listSuppliers, listSuppliersByIds, updateSupplier } from "./suppliers.service.js";
import { actorOf } from "#security/auth.plugin.js";

const routes: FastifyPluginAsyncZod = async (app) => {
    app.get(
        "/",
        {
            schema: { querystring: listSuppliersQuery, response: { 200: supplierPage}},
            config: { permission: "SUPPLIERS.VIEW", cache: ["Supplier"]}
        },
        (req) => listSuppliers(req.query),
    )

    // The rows a live `supplier` event names (GET /api/v1/events), deleted ones included, so a client keeping the whole
    // list reloads only those. Not cached: the event can arrive before the Supplier cache is cleared, and a cached copy
    // would bring the old row back.
    app.get(
        "/by-ids",
        {
            schema: { querystring: supplierIdsQuery, response: { 200: supplierList } },
            config: { permission: "SUPPLIERS.VIEW" },
        },
        (req) => listSuppliersByIds(req.query.ids),
    )

    app.get(
        "/:id",
        {
            schema: { params: supplierIdParams, response: { 200: supplier }},
            config: { permission: "SUPPLIERS.VIEW"},
        },
        (req) => getSupplier(req.params.id),
    )

    app.post(
        "/",
        {
            schema: { body: createSupplierBody, response: { 201: supplier }},
            config: { permission: "SUPPLIERS.CREATE" }
        },
        async (req, reply) => reply.status(201).send(await createSupplier(req.body, actorOf(req))),
    )

    app.patch(
        "/:id",
        {
            schema: { params: supplierIdParams, body: updateSupplierBody, response: { 200: supplier}},
            config: { permission: "SUPPLIERS.EDIT" },
        },
        (req) => updateSupplier(req.params.id, req.body, actorOf(req)),
    )

    app.delete(
        "/:id",
        {
            schema: { params: supplierIdParams },
            config: { permission: "SUPPLIERS.DELETE" },
        },
        async (req, reply) => {
            await deleteSupplier(req.params.id, actorOf(req))
            return reply.status(204).send()
        }
    )
}

export default routes