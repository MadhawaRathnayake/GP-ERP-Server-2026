import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { actorOf } from "#security/auth.plugin.js"
import {
  checkSerialNumbersBody,
  listSerialItemsQuery,
  serialItem,
  serialItemIdParams,
  serialItemPage,
  serialNumberCheck,
  stockCheck,
  updateSerialItemBody,
} from "./serial-items.schema.js"
import { checkSerialNumbers, getSerialItem, listSerialItems, stockCheck as runStockCheck, updateSerialItem } from "./serial-items.service.js"

// Units are registered, sold and removed by the documents and stock adjustments that move them, not here.
const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/",
    {
      schema: { querystring: listSerialItemsQuery, response: { 200: serialItemPage } },
      config: { permission: "SERIAL_ITEMS.VIEW", cache: ["SerialItem", "SerialItemAccessory", "Accessory", "Product", "Invoice"] },
    },
    (req) => listSerialItems(req.query),
  )

  app.get(
    "/stock-check",
    {
      schema: {
        description: "Serial products whose stock in hand isn't their number of units in stock",
        response: { 200: stockCheck },
      },
      config: { permission: "SERIAL_ITEMS.VIEW", cache: ["SerialItem", "Product"] },
    },
    () => runStockCheck(),
  )

  // A POST so a long list fits; it only reads.
  app.post(
    "/check",
    {
      schema: {
        description: "Checks serials before they are saved: new, repeated in the list, or already used (by a unit or an accessory)",
        body: checkSerialNumbersBody,
        response: { 200: serialNumberCheck },
      },
      config: { permission: "SERIAL_ITEMS.VIEW" },
    },
    (req) => checkSerialNumbers(req.body.serialNumbers),
  )

  app.get(
    "/:id",
    {
      schema: { params: serialItemIdParams, response: { 200: serialItem } },
      config: {
        permission: "SERIAL_ITEMS.VIEW",
        cache: ["SerialItem", "SerialItemAccessory", "SerialItemMovement", "Accessory", "Product", "Invoice", "Customer", "User"],
      },
    },
    (req) => getSerialItem(req.params.id),
  )

  app.patch(
    "/:id",
    {
      schema: { params: serialItemIdParams, body: updateSerialItemBody, response: { 200: serialItem } },
      config: { permission: "SERIAL_ITEMS.EDIT" },
    },
    (req) => updateSerialItem(req.params.id, req.body, actorOf(req)),
  )
}

export default routes
