# Revolut CSV Import — Wealthfolio Add-On

Import Revolut account-statement CSV exports into a Wealthfolio cash account so your
card spending flows into the spending module. Revolut has no free personal API, so
this add-on is CSV-only.

See the [repository README](../README.md) for full documentation, export steps and
install instructions.

## Development

```bash
npm install
npm run test        # vitest unit tests
npm run type-check  # tsc --noEmit
npm run build       # dist/addon.js
npm run bundle      # dist/revolut-addon-<version>.zip
```
