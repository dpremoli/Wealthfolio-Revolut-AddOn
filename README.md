# Wealthfolio Revolut Add-On

Import your **Revolut** account statements into [Wealthfolio](https://wealthfolio.app)
and feed your card spending into the spending module — all from a CSV export.

This add-on is built in the same style as the
[Monzo](https://github.com/dpremoli/Wealthfolio-Monzo-AddOn) and
[Trading 212](https://github.com/dpremoli/Wealthfolio-Trading212-Add-On) add-ons,
but it is **CSV-only**.

## Why CSV (and not an API)?

Revolut does **not** offer a free API for personal accounts:

- The **Open Banking API** is restricted to regulated banking partners (AISPs) — you
  cannot use it for your own personal account.
- The **Business API** only covers Revolut *Business* accounts.

So there is no proxy or OAuth to set up here — you simply export a statement from the
Revolut app and import the CSV. (If Revolut ever ship a usable personal API, this can
be extended like the Monzo/Trading 212 add-ons.)

## What it does

- Parses a Revolut account-statement CSV
  (`Type, Product, Started Date, Completed Date, Description, Amount, Fee, Currency, State, Balance`).
- Imports only **completed** transactions (pending/declined/reverted rows are skipped).
- Maps each row to a Wealthfolio cash activity:
  - debits → `WITHDRAWAL`, credits → `DEPOSIT`;
  - the merchant/description is kept as the activity comment so **Wealthfolio's
    spending module can categorise it**;
  - any separate Revolut **fee** is imported as its own `FEE` activity so the cash
    balance stays accurate.
- Optionally **skips internal movements** (transfers, exchanges, top-ups) so you can
  import card spending only — a checkbox on the import screen, on by default.
- Lets you import into an **existing** account or **create a dedicated Revolut cash
  account** (CASH, transactions-tracked, in the statement's currency) with one click.
- De-duplicates re-imports: each row gets a stable id derived from its date, amount,
  description and running balance, so importing overlapping statements is safe.

## How to export your statement from Revolut

1. Open the Revolut app and tap your account.
2. Tap **⋯ → Statement**.
3. Choose **Excel/CSV** format, pick a date range, and generate it.
4. Save the `.csv` file to your computer.

## Install

1. Download `revolut-addon.zip` from the [latest release](../../releases/latest).
2. In Wealthfolio: **Settings → Add-ons → Install from ZIP** and select the file.
3. Enable the add-on. A **Revolut Import** item appears in the sidebar.

## Import

1. Open **Revolut Import** in the sidebar, then **Import CSV**.
2. Choose your exported CSV.
3. Pick a target account (or click **+ Revolut account** to create one).
4. Choose whether to skip transfers/exchanges/top-ups, then **Import**.

## Development

```bash
cd addon
npm install
npm run test        # unit tests (vitest)
npm run type-check  # tsc --noEmit
npm run build       # produces dist/addon.js
npm run bundle      # clean + build + zip → dist/revolut-addon-<version>.zip
```

The add-on is a single-file ES module (`dist/addon.js`) built with Vite; React and
ReactDOM are provided by the Wealthfolio host. Releases are produced automatically by
`.github/workflows/release.yml` when a `v*` tag is pushed.

## License

GPL-3.0 — see [LICENSE](LICENSE).
