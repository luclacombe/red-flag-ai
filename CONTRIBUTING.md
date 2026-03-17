# Contributing to RedFlag AI

Thanks for your interest in contributing! This guide will help you get started.

## Development Setup

Follow the [Quick Start](README.md#quick-start) in the README to get a local environment running.

## Quality Gate

All changes must pass the full quality gate before merging:

```bash
pnpm turbo lint type-check test build
```

## Commit Convention

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — new feature
- `fix:` — bug fix
- `refactor:` — code restructuring (no behavior change)
- `test:` — adding or updating tests
- `docs:` — documentation only
- `chore:` — tooling, deps, CI, config

## Pull Request Process

1. Fork the repo and create a feature branch from `main`
2. Make your changes and ensure the quality gate passes
3. Write a clear PR description explaining **what** changed and **why**
4. Link related issues if applicable
5. Request a review

## Code Style

- **TypeScript strict** — no `any`, no `as` casts unless truly unavoidable
- **Biome** for linting and formatting (not ESLint/Prettier)
- **Zod validation** at all boundaries
- Run `npx biome check --write .` to auto-fix formatting issues

## Architecture

See [README.md](README.md#architecture) for the pipeline overview and project structure. The dependency direction is `web → api → agents → db → shared` — never import upstream.
