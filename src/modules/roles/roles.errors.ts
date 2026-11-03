import { AppError } from "#http/errors.js"

/** Someone tried to rename a system role (Super Admin) or change its permissions; it always has every permission. */
export class SystemRoleError extends AppError {
  constructor() {
    super(409, "SYSTEM_ROLE", "This is a system role: it always has every permission, and its name and permissions can't be changed")
  }
}
