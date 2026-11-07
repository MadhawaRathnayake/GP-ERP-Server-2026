# Docs

Things that are set up once and then happen on their own, so they're easy to forget. Read the matching page before
changing that area.

| Page | What it covers |
|---|---|
| [database.md](database.md) | Who fills each column (database, service or nobody), id formats, soft delete, money and time |
| [migrations.md](migrations.md) | How to change the database safely, and what each migration did |
| [automatic.md](automatic.md) | What runs without code: permission sync, cache invalidation, sessions, Redis fallback |
| [logging.md](logging.md) | Where logs go (the terminal only) and how to see more or fewer |
| [known-issues.md](known-issues.md) | Open problems found in the code, with the fix for each |
| [screens/](screens/) | Build plans for each screen, backend and frontend (start with [customers.md](screens/customers.md)) |
| [plans/](plans/) | Larger features ported from the old system ([invoices.md](plans/invoices.md)): what was built and what's left |

Other docs in the repo root: `README.md` (how the API works), `ARCHITECTURE.md` (layers and rules),
`ADDING-A-FEATURE.md` (the general walkthrough for a new feature), `AGENTS.md` (rules for AI agents).

## Keeping these up to date

- Set up something that will happen without anyone calling it (a default, a trigger, a hook, a background job)? Add a
  line to the matching page.
- Found a bug you aren't fixing now? Add it to `known-issues.md`. Fixed one? Delete its entry.
- New screen? Copy `screens/customers.md` to `screens/<screen>.md` and fill it in before writing code.
