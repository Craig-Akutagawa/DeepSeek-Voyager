# Repository Guidelines

## Project Structure & Module Organization

This is a Vite, React, and TypeScript browser extension for DeepSeek. Source code lives in `src/`. Extension entry points are under `src/pages/`: `content/` for page injection, `background/` for extension background logic, and `popup/`, `options/`, `panel/`, and `devtools/` for UI pages. Shared UI components are in `src/components/`, reusable hooks in `src/hooks/`, core services and utilities in `src/core/`, and feature modules in `src/features/`. Static extension assets are in `public/`; Safari-specific native files are in `safari/`. Tests are colocated in `__tests__` folders or use `*.test.ts`.

## Build, Test, and Development Commands

Use Bun when possible because this repository includes `bun.lock`.

- `bun install`: install dependencies.
- `bun run dev:chrome`: watch and rebuild the Chrome extension with Nodemon.
- `bun run build:chrome`: build the Chromium extension output.
- `bun run build:firefox`: build the Firefox extension output.
- `bun run build:safari`: build the Safari extension output.
- `bun run build:all`: build all supported browser targets.
- `bun run typecheck`: run TypeScript checks without emitting files.
- `bun run test`: run the Vitest suite once.
- `bun run lint`: run ESLint with automatic fixes.
- `bun run format`: format the repository with Prettier.

## Coding Style & Naming Conventions

Write TypeScript and React code using the existing module style. Use PascalCase for React components, camelCase for functions and variables, and descriptive service names such as `StorageService` or `ConversationExportService`. Keep feature-specific code inside its feature directory rather than adding broad shared utilities prematurely. Formatting is handled by Prettier; linting uses ESLint with TypeScript, React, hooks, import, and accessibility plugins.

## Testing Guidelines

Vitest is the test runner, with `jsdom` configured for DOM-oriented tests. Add focused tests beside the code being changed, preferably in `__tests__` directories using names like `FeatureName.test.ts`. For behavior changes, include at least one regression test that fails before the fix. Run `bun run test` and `bun run typecheck` before submitting changes; use `bun run test:coverage` when touching shared services or utilities.

## Commit & Pull Request Guidelines

Recent history uses Conventional Commit-style messages such as `feat(concurrency): ...`, `docs(readme): ...`, and `chore: ...`. Prefer `type(scope): summary` with a concise imperative summary. Pull requests should describe the user-visible change, list verification commands run, link related issues, and include screenshots or recordings for popup, options, panel, or content-script UI changes.

## Agent-Specific Instructions

Keep changes surgical and project-specific. Do not modify generated build output unless explicitly requested. Use `gemini-voyager` only as a reference source; do not copy code without checking license and adapting it to this DeepSeek-specific implementation.
