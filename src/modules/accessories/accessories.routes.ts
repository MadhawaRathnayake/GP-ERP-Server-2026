import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { actorOf } from "#security/auth.plugin.js"
import {
  accessory,
  accessoryIdParams,
  accessoryList,
  createAccessoryBody,
  listAccessoriesQuery,
  updateAccessoryBody,
} from "./accessories.schema.js"
import { createAccessory, deleteAccessory, getAccessory, listAccessories, updateAccessory } from "./accessories.service.js"

// The accessory list. What comes with a product is under /products/:id/accessories (products.routes.ts).
const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/",
    {
      schema: { querystring: listAccessoriesQuery, response: { 200: accessoryList } },
      config: { permission: "ACCESSORIES.VIEW", cache: ["Accessory", "Product"] },
    },
    (req) => listAccessories(req.query),
  )

  app.get(
    "/:id",
    {
      schema: { params: accessoryIdParams, response: { 200: accessory } },
      config: { permission: "ACCESSORIES.VIEW", cache: ["Accessory", "Product"] },
    },
    (req) => getAccessory(req.params.id),
  )

  app.post(
    "/",
    {
      schema: { body: createAccessoryBody, response: { 201: accessory } },
      config: { permission: "ACCESSORIES.CREATE" },
    },
    async (req, reply) => reply.status(201).send(await createAccessory(req.body, actorOf(req))),
  )

  app.patch(
    "/:id",
    {
      schema: { params: accessoryIdParams, body: updateAccessoryBody, response: { 200: accessory } },
      config: { permission: "ACCESSORIES.EDIT" },
    },
    (req) => updateAccessory(req.params.id, req.body, actorOf(req)),
  )

  app.delete(
    "/:id",
    {
      schema: { params: accessoryIdParams },
      config: { permission: "ACCESSORIES.DELETE" },
    },
    async (req, reply) => {
      await deleteAccessory(req.params.id, actorOf(req))
      return reply.status(204).send()
    },
  )
}

export default routes
