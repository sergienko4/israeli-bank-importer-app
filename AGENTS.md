# Expo HAS CHANGED

Read the exact versioned docs at <https://docs.expo.dev/versions/v54.0.0/> before writing any code.

This app targets **Expo SDK 54** (`expo@~54.0.0`, `react-native@0.81.5`, `react@19.1.0`).
Match that line for every dependency and API - do not use SDK 57 docs or examples.

## Code quality gates

A strict, type-aware ESLint config (`eslint.config.mjs`) plus Prettier and Husky
hooks are enforced. Before committing, keep these green:

- `npm run lint` - strict ESLint, `--max-warnings=0`, **no** `eslint-disable`/`any`/non-null `!`.
- `npm run format:check` - Prettier.
- `npm run typecheck` and `npm test`.

Hooks run automatically: **pre-commit** (`lint-staged`), **commit-msg**
(commitlint / Conventional Commits), **pre-push** (typecheck + tests). Requires
**Node.js 22+**. Every exported symbol needs a JSDoc block.
