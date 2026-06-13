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
- **One cash account per currency.** A single Revolut export can mix currencies
  (e.g. GBP, EUR, USD). The add-on detects each currency and imports its rows into a
  dedicated `Revolut <CCY>` account, so every account reconciles to Revolut's own
  per-currency balance instead of mixing currencies in one account.
- Maps each row to a Wealthfolio cash activity by its Revolut type:
  - Card Payment / ATM → `WITHDRAWAL`, card refunds / credits → `DEPOSIT`;
  - Transfers & Exchanges → `TRANSFER_IN`/`TRANSFER_OUT` — kept in the balance but
    **excluded from spending analytics** (a cross-currency exchange becomes a
    `TRANSFER_OUT` on one account and a `TRANSFER_IN` on the other, and both reconcile);
  - Top-ups → `DEPOSIT` (incoming funding / income);
  - the merchant/description is kept as the activity comment so **Wealthfolio's
    spending module can categorise it**;
  - any separate Revolut **fee** is imported as its own `FEE` activity so the cash
    balance stays accurate.
- Seeds each account's **opening balance** so the imported balance reconciles to
  Revolut. A statement only lists movements within its date range, so summing them
  would give the *net flow*, not the real balance — the account would be short by
  whatever it held before the first row (this is what makes a balance come out
  negative). The opening balance is recovered per currency from the earliest row's
  `Balance` column and imported as a single dated `Opening balance` activity.
- Lets you map each currency to an **existing** account or **create a dedicated
  `Revolut <CCY>` cash account** (CASH, transactions-tracked) with one click, and
  remembers the mapping for next time.
- Imports every transaction faithfully, even genuine duplicates. Wealthfolio's importer
  otherwise merges any two activities that share the same account, day, type and amount
  (e.g. two £1,000 transfers on one day, or a repeated charge), silently dropping real
  money. The add-on forces each row in and instead de-duplicates against what's already in
  the account, so importing the same or an overlapping statement twice adds nothing while
  genuinely repeated transactions are all kept.

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
3. For each currency detected, pick an account or click **+ Revolut <CCY>** to create
   one (or **Create all missing accounts**).
4. Click **Import**. Each currency's rows go to its mapped account; re-importing the
   same or an overlapping statement is safe (it adds nothing).

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
