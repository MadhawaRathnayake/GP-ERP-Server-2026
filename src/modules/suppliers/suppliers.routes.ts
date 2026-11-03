import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { createSupplierBody, listSuppliersQuery, supplier, supplierIdParams, supplierPage, updateSupplierBody } from "./suppliers.schema.js";
import { createSupplier, deleteSupplier, getSupplier, listSuppliers, updateSupplier } from "./suppliers.service.js";
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