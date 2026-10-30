import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { actorOf } from "#security/auth.plugin.js"
import { createImageUploadUrl } from "./products.images.js"
import {
  createProductBody,
  imageUpload,
  imageUploadBody,
  listProductsQuery,
  product,
  productIdParams,
  productPage,
  updateProductBody,
} from "./products.schema.js"
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
      schema: { params: productIdParams, response: { 200: product } },
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

  // Step 1 of saving an image: the browser PUTs the file to uploadUrl, then sends publicUrl as imageUrl.
  app.post(
    "/image-upload-url",
    {
      schema: { body: imageUploadBody, response: { 200: imageUpload } },
      config: { permission: "PRODUCTS.EDIT" },
    },
    (req) => createImageUploadUrl(req.body.contentType),
  )

  app.patch(
    "/:id",
    {
      schema: { params: productIdParams, body: updateProductBody, response: { 200: product } },
      config: { permission: "PRODUCTS.EDIT" },
    },
    (req) => updateProduct(req.params.id, req.body, actorOf(req)),
  )

  app.delete(
    "/:id",
    {
      schema: { params: productIdParams },
      config: { permission: "PRODUCTS.DELETE" },
    },
    async (req, reply) => {
      await deleteProduct(req.params.id, actorOf(req))
      return reply.status(204).send()
    },
  )
}

export default routes
