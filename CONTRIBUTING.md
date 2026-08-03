# Contributing to Aegis

Thank you for your interest in contributing to Aegis! This document provides guidelines and instructions for contributing.

## Code of Conduct

Please read and follow our [Code of Conduct](./CODE_OF_CONDUCT.md).

## How to Contribute

1. **Fork** the repository
2. **Create a feature branch** from `main`: `git checkout -b feature/your-feature-name`
3. **Make your changes** with clear, descriptive commit messages
4. **Write tests** for any new functionality
5. **Ensure all tests pass**: `forge test` (contracts), `go test ./...` (extension), `npm test` (SDK/frontend)
6. **Submit a Pull Request** with a clear description of the changes

## Pull Request Template

```markdown
## Summary
Brief description of what this PR does.

## Testing
- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Manual testing performed

## Breaking Changes
- [ ] No breaking changes
- [ ] Breaking changes documented below:
```

## Code Review

All PRs require at least one review before merging. Reviewers should verify:

- Code correctness and clarity
- Test coverage
- Adherence to the project architecture
- Security considerations

## Development Setup

See [README.md](./README.md#quickstart) for setup instructions.

## Issue Templates

When filing issues, please use the appropriate template:

- **Bug**: Include steps to reproduce, expected behavior, and actual behavior
- **Feature**: Include motivation, proposed solution, and alternatives considered
- **Security**: Report security vulnerabilities privately to the maintainers

## Branch Naming

- `feature/` for new features
- `fix/` for bug fixes
- `docs/` for documentation changes
- `refactor/` for code refactoring

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add vault deposit functionality
fix: resolve solvency root computation edge case
docs: update architecture diagram
```
