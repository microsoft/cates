---
applyTo: "src/api/**/*.ts"
---

# Express API conventions (`src/api/`)

- Define each route in its own file under `src/api/routes/`; register it in `src/api/router.ts`.
- Validate request bodies with the Zod schema in `src/api/schemas/`, not inline checks.
- Throw `AppError` from `src/errors.ts`; the error middleware maps it to a status code.
- Reach the database through repositories in `src/db/`; never import Drizzle clients into a route.
- Cover each new route with an integration test in `tests/api/` using `createTestContext()`.
