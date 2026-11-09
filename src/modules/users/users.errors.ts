import { AppError } from "#http/errors.js"

/** A user tried to change their own role or status (deactivate or restore themselves). */
export class OwnAccountError extends AppError {
  constructor() {
    super(403, "OWN_ACCOUNT", "You can change your own name, email and password, but not your own role or status")
  }
}

/** Someone other than the Super Admin tried to change the Super Admin's account. */
export class SuperAdminUserError extends AppError {
  constructor() {
    super(403, "SUPER_ADMIN_USER", "Only the Super Admin can change the Super Admin's account")
  }
}
