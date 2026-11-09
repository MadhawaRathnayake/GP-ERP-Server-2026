import { AppError } from "#http/errors.js"

/** Someone tried to change the system role (Super Admin) or give a user that role. It always has every permission. */
export class SystemRoleError extends AppError {
  constructor() {
    super(409, "SYSTEM_ROLE", "The Super Admin role can't be changed, and no user can be given it")
  }
}

/** The role (or the user's role) isn't below the acting admin's own role. */
export class OutsideBranchError extends AppError {
  constructor(message = "You can only manage the roles under your own role") {
    super(403, "OUTSIDE_BRANCH", message)
  }
}

/** The change adds or removes permissions the acting admin may not grant (roles.access.ts → canGrant). */
export class NotGrantableError extends AppError {
  constructor(permissions: readonly string[]) {
    super(
      403,
      "NOT_GRANTABLE",
      `You can't give or take away: ${permissions.join(", ")}. Admins can give only permissions their own role has, ` +
        "and only the Super Admin gives Settings, Dropdowns and Approvals",
      { permissions },
    )
  }
}

/** Only the Super Admin moves a role under a different managing role, and never under itself or a role below it. */
export class ParentChangeError extends AppError {
  constructor(message = "Only the Super Admin can move a role under a different role") {
    super(403, "PARENT_CHANGE", message)
  }
}
