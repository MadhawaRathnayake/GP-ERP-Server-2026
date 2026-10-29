// Every module is mounted under this prefix (app.ts): /api/v1/products, /api/v1/auth/login, ...
//
// Clients that can't be updated together with the server (mobile apps) keep calling the version they were built for.
// Additive changes (a new field, a new route) stay in v1. A breaking change (a removed/renamed field, a changed
// meaning) needs a v2 route next to the v1 one — see ARCHITECTURE.md → "Versioning".
export const API_PREFIX = "/api/v1"
