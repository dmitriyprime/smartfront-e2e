# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
npm install

# Install Playwright browsers (required once after cloning)
npx playwright install --with-deps chromium

# Run all tests
npx playwright test

# Run a single test file
npx playwright test tests/example.spec.ts

# Run tests matching a name pattern
npx playwright test --grep "has title"

# Run tests with UI mode (interactive)
npx playwright test --ui

# Show HTML report from last run
npx playwright show-report

# Lint and format
npm run lint        # ESLint only
npm run format      # Prettier write
npm run check       # lint + format check (use before committing)
```

## Architecture

This is a pure Playwright E2E test project with no build step — TypeScript is handled directly by Playwright's test runner.

**Key files:**
- `playwright.config.ts` — Test configuration: base URL, parallelism, retries, browser targets
- `tests/` — All test specs live here
- `pages/BasePage.ts` — Abstract base class for Page Objects; exposes `navigate()` and `currentPage`. All page object classes should extend this.
- `tsconfig.json` — TypeScript config; `"types": ["node"]` ensures `process.env` resolves correctly

**Browser:** Tests run against Chromium only (`chromium-e2e` project using Desktop Chrome device).

**Base URL:** Defaults to `https://ecommerce-dev.gomage.dev`. Override by setting `BASE_URL` in a `.env` file (see `.env.example`) and uncommenting the dotenv block in `playwright.config.ts`.

**CI vs. local behavior:** `playwright.config.ts` detects `process.env.CI` — 2 retries, single worker, and `forbidOnly` on CI; no retries and full parallelism locally.

**CI/CD:** `.github/workflows/playwright.yml.disabled` contains a GitHub Actions workflow that is disabled. Remove the `.disabled` suffix to activate it.

**Trace artifacts:** Test traces are collected on first retry and saved to `test-results/`. HTML reports go to `playwright-report/`. Both are gitignored.

**Linting:** ESLint flat config (`eslint.config.mts`) with `eslint-plugin-playwright` enforcing Playwright best practices (no `networkidle`, no `waitForTimeout`, prefer web-first assertions, etc.).
