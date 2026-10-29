import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { idParams } from "#http/fields.js"
import { actorOf } from "#security/auth.plugin.js"
import { createProductBody, listProductsQuery, product, productPage, updateProductBody } from "./products.schema.js"
import { createProduct, deleteProduct, getProduct, listProducts, updateProduct } from "./products.service.js"

const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/",
    {
      schema: { querystring: listProductsQuery, response: { 200: productPage } },
      config: { permission: "PRODUCTS.VIEW", cache: ["Product"] },
    },
    (req) => listProducts(req.query),
  )

  app.get(
    "/:id",
    {
      schema: { params: idParams, response: { 200: product } },
      config: { permission: "PRODUCTS.VIEW", cache: ["Product"] },
    },
    (req) => getProduct(req.params.id),
  )

  app.post(
    "/",
    {
      schema: { body: createProductBody, response: { 201: product } },
      config: { permission: "PRODUCTS.CREATE" },
    },
    async (req, reply) => reply.status(201).send(await createProduct(req.body, actorOf(req))),
  )

  app.patch(
    "/:id",
    {
      schema: { params: idParams, body: updateProductBody, response: { 200: product } },
      config: { permission: "PRODUCTS.EDIT" },
    },
    (req) => updateProduct(req.params.id, req.body, actorOf(req)),
  )

  app.delete(
    "/:id",
    {
      schema: { params: idParams },
      config: { permission: "PRODUCTS.DELETE" },
    },
    async (req, reply) => {
      await deleteProduct(req.params.id, actorOf(req))
      return reply.status(204).send()
    },
  )
}

export default routes
