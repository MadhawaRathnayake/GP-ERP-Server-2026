import fp from "fastify-plugin"
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from "fastify-type-provider-zod"
import { Prisma } from "#generated/prisma/client.js"
import { AppError } from "./errors.js"

// The one place errors become HTTP responses. Every error body has the shape:
//   { error: { code, message, details?, requestId } }
// Routes and services never try/catch just to format a response — throw an AppError instead.

type ErrorBody = { statusCode: number; code: string; message: string; details?: unknown }

const prismaErrors: Record<string, Omit<ErrorBody, "details">> = {
  P2002: { statusCode: 409, code: "CONFLICT", message: "A record with this value already exists" },
  P2003: { statusCode: 409, code: "CONFLICT", message: "The record is referenced by, or references, another record" },
  P2025: { statusCode: 404, code: "NOT_FOUND", message: "Record not found" },
}

function toErrorBody(err: unknown): ErrorBody | undefined {
  if (err instanceof AppError) {
    return { statusCode: err.statusCode, code: err.code, message: err.message, details: err.details }
  }
  if (hasZodFastifySchemaValidationErrors(err)) {
    return {
      statusCode: 400,
      code: "VALIDATION_ERROR",
      message: "Request validation failed",
      details: err.validation.map((v) => ({ in: err.validationContext, path: v.instancePath, message: v.message })),
    }
  }
  // err.meta names tables and constraints: it's logged with the error, never sent to the client.
  if (err instanceof Prisma.PrismaClientKnownRequestError && prismaErrors[err.code]) {
    return prismaErrors[err.code]
  }
  // Fastify's own client errors (malformed JSON, payload too large, ...)
  const statusCode = (err as { statusCode?: number }).statusCode
  if (statusCode && statusCode >= 400 && statusCode < 500 && !isResponseSerializationError(err)) {
    return { statusCode, code: (err as { code?: string }).code ?? "BAD_REQUEST", message: (err as Error).message }
  }
  return undefined
}

export default fp(
  async (app) => {
    app.setErrorHandler((err, request, reply) => {
      const body = toErrorBody(err)
      if (body) {
        request.log.info({ err }, body.message)
        return reply.status(body.statusCode).send({ error: { code: body.code, message: body.message, details: body.details, requestId: request.id } })
      }
      // Unknown failure (includes a response not matching its schema): log the full error, return a generic message.
      request.log.error({ err }, "unhandled error")
      return reply.status(500).send({ error: { code: "INTERNAL_ERROR", message: "Internal server error", requestId: request.id } })
    })

    app.setNotFoundHandler((request, reply) =>
      reply.status(404).send({ error: { code: "ROUTE_NOT_FOUND", message: `Route ${request.method} ${request.url} not found`, requestId: request.id } }),
    )
  },
  { name: "error-handler" },
)
