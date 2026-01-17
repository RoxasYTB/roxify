# Release 1.6.2 — Fix ESM native loader on Windows

**Roxify 1.6.2** fixes an issue where the CLI or package in ESM environments (e.g., `node --input-type=module` or when installed globally) could fail to find the native `.node` artifacts on Windows. The loader previously used `process.cwd()` as the module directory in ESM mode which caused the `Native module not found` error.

Highlights

- **Fix:** Derive the package `moduleDir` from `import.meta.url` when `__dirname` is not available (ESM) and use `createRequire(import.meta.url)` for `require()` fallback. This ensures bundled native files (`roxify_native*.node`, `libroxify_native*.node`) are found when running the CLI or using ESM imports.

Upgrade

```bash
npm install -g roxify@1.6.2
```

Notes

- This is a small patch release (bugfix). No CLI surface changes, only improved native loading in ESM scenarios.

Local build note

- On Linux hosts without MSVC cross-compilers the `npm run release:prepare` step may fail while building some targets. To prepare a release locally and keep available artifacts, run:

```bash
IGNORE_TARGET_FAILURES=1 npm run release:prepare
```

This will skip failing cross-target builds and copy available artifacts into `release/` for manual upload.
