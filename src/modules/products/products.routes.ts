import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { actorOf } from "#security/auth.plugin.js"
import { productAccessoryList, setProductAccessoriesBody } from "#modules/accessories/accessories.schema.js"
import { listProductAccessories, setProductAccessories } from "#modules/accessories/accessories.service.js"
import { createImageUploadUrl } from "./products.images.js"
import {
  createProductBody,
  imageUpload,
  imageUploadBody,
  listProductsQuery,
  product,
  productIdParams,
  productPage,
  stockAdjustmentBody,
  updateProductBody,
} from "./products.schema.js"
import { adjustStock, createProduct, deleteProduct, getProduct, listProducts, updateProduct } from "./products.service.js"

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

  // What comes with a product is part of the product, so it takes the product's codes, not ACCESSORIES.* (an exception
  // to "own permission group"): whoever may edit the product may say what comes in its box. ACCESSORIES.* is for the
  // accessory list itself (modules/accessories).
  app.get(
    "/:id/accessories",
    {
      schema: { description: "What comes with every unit of the product", params: productIdParams, response: { 200: productAccessoryList } },
      config: { permission: "PRODUCTS.VIEW", cache: ["ProductAccessory", "Accessory", "Product"] },
    },
    (req) => listProductAccessories(req.params.id),
  )

  app.put(
    "/:id/accessories",
    {
      schema: { params: productIdParams, body: setProductAccessoriesBody, response: { 200: productAccessoryList } },
      config: { permission: "PRODUCTS.EDIT" },
    },
    (req) => setProductAccessories(req.params.id, req.body, actorOf(req)),
  )

  app.post(
    "/:id/stock-adjustments",
    {
      schema: {
        description:
          "Changes stock by hand, with a reason: `quantity` for a quantity-tracked product; `add`, `remove` or `register` units for a serial-tracked one (409 TRACKING_MISMATCH otherwise).",
        params: productIdParams,
        body: stockAdjustmentBody,
        response: { 200: product },
      },
      config: { permission: "PRODUCTS.ADJUST_STOCK" },
    },
    (req) => adjustStock(req.params.id, req.body, actorOf(req)),
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
