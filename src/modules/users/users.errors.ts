import { AppError } from "#http/errors.js"

/** An admin tried to take away their own ability to manage users, which could leave nobody able to. */
export class SelfLockoutError extends AppError {
  constructor(message = "You can't remove your own user-management permission or deactivate yourself") {
    super(409, "SELF_LOCKOUT", message)
  }
}

/** The change would leave no active user with the system role (Super Admin), so nobody could manage the app. */
export class LastSuperAdminError extends AppError {
  constructor() {
    super(409, "LAST_SUPER_ADMIN", "At least one active user must keep the Super Admin role")
  }
}
