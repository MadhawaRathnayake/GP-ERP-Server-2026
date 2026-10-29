import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { actorOf } from "#security/auth.plugin.js"
import { category, categoryIdParams, categoryList, createCategoryBody, listCategoriesQuery, updateCategoryBody } from "./categories.schema.js"
import { createCategory, deleteCategory, getCategory, listCategories, updateCategory } from "./categories.service.js"

// Categories are part of the product catalogue, so they use the PRODUCTS permissions.
const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/",
    {
      schema: { querystring: listCategoriesQuery, response: { 200: categoryList } },
      config: { permission: "PRODUCTS.VIEW", cache: ["Category"] },
    },
    (req) => listCategories(req.query),
  )

  app.get(
    "/:id",
    {
      schema: { params: categoryIdParams, response: { 200: category } },
      config: { permission: "PRODUCTS.VIEW", cache: ["Category"] },
    },
    (req) => getCategory(req.params.id),
  )

  app.post(
    "/",
    {
      schema: { body: createCategoryBody, response: { 201: category } },
      config: { permission: "PRODUCTS.CREATE" },
    },
    async (req, reply) => reply.status(201).send(await createCategory(req.body, actorOf(req))),
  )

  app.patch(
    "/:id",
    {
      schema: { params: categoryIdParams, body: updateCategoryBody, response: { 200: category } },
      config: { permission: "PRODUCTS.EDIT" },
    },
    (req) => updateCategory(req.params.id, req.body, actorOf(req)),
  )

  app.delete(
    "/:id",
    {
      schema: { params: categoryIdParams },
      config: { permission: "PRODUCTS.DELETE" },
    },
    async (req, reply) => {
      await deleteCategory(req.params.id, actorOf(req))
      return reply.status(204).send()
    },
  )
}

export default routes
