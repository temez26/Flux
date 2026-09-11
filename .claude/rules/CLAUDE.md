# Project Instructions

## General Principles

Follow these principles in all code changes and architectural decisions:

- **YAGNI (You Aren't Gonna Need It)**: Implement only what is currently required. Avoid speculative features, abstractions, and infrastructure.
- **DRY (Don't Repeat Yourself)**: Reuse existing logic and abstractions when appropriate. Avoid unnecessary duplication.
- **KISS (Keep It Simple)**: Prefer the simplest solution that is clear, maintainable, and sufficient for the requirement. Avoid unnecessary complexity and over-engineering.
- **SOLID**: Apply SOLID principles where they improve maintainability, especially:
  - **Single Responsibility**: Each module/class should have a clear responsibility.
  - **Open/Closed**: Prefer extending behavior over modifying stable code when practical.
  - **Liskov Substitution**: Implementations should remain safely substitutable for their abstractions.
  - **Interface Segregation**: Avoid forcing consumers to depend on functionality they do not use.
  - **Dependency Inversion**: Depend on abstractions where it provides meaningful flexibility or testability.

## Coding Standards

- **Readability**: Write clean, expressive, self-documenting code with meaningful names.
- **Comments**: Do not write comments that merely describe what the code does. Comment only when explaining *why*, documenting non-obvious behavior, or providing necessary public API documentation.
- **Consistency**: Follow the project's existing architecture, patterns, naming conventions, formatting, and tooling.
- **Reuse**: Before introducing a new abstraction, utility, component, or dependency, check whether an existing solution can be reused.
- **Minimal Changes**: Make the smallest reasonable change that fully solves the problem. Avoid unrelated refactoring.

## Workflow

- **Important**: At the beginning of every new chat, read the project's root `README.md` once before making suggestions or code changes.
- Before changing architecture or introducing new dependencies, inspect the existing project structure and conventions.
- Prefer existing project patterns over introducing new ones unless there is a clear reason to deviate.
- When requirements are ambiguous, make the most reasonable interpretation based on the existing codebase and project conventions rather than over-engineering.