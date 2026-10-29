// Throw these from services, routes or hooks; platform/http/error-handler.plugin.ts turns them into
//   { error: { code, message, details?, requestId } }
// For an error specific to one feature, extend AppError inside that feature's folder (e.g. customers.errors.ts).
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = new.target.name
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, "BAD_REQUEST", message, details)
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Not signed in or session expired") {
    super(401, "UNAUTHENTICATED", message)
  }
}

export class ForbiddenError extends AppError {
  constructor(permission: string) {
    super(403, "FORBIDDEN", `Missing permission: ${permission}`, { permission })
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string, id: string) {
    super(404, "NOT_FOUND", `${entity} ${id} not found`)
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, "CONFLICT", message)
  }
}
