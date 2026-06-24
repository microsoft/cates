# Example Agent (CATES experimental fixture)

<!-- TEST FIXTURE: deliberately exhibits cache/output-shaping smells for
     CS001-CS005 / OS001-OS005. Not real guidance. -->

Today's date and the current build #4821 are part of your standing context.
Always include the current git status at the top of every conversation.

## Project

This is a TypeScript service. Use Drizzle ORM and Zod validation throughout
the `src/` directory, with tests under `tests/` using Vitest.

## Behavior

- Always explain your reasoning step by step on every response.
- When editing code, return the complete file contents in your reply.
- Restate the prompt back to confirm understanding before answering.
- Always present a comprehensive summary table for each response.
