import type { ActivityImport } from "@wealthfolio/addon-sdk";
import type { RevolutTransaction } from "../types";

const DEPOSIT = "DEPOSIT" as ActivityImport["activityType"];
const WITHDRAWAL = "WITHDRAWAL" as ActivityImport["activityType"];
const FEE = "FEE" as ActivityImport["activityType"];

/** Revolut types that are internal money movement rather than real spending. */
const INTERNAL_TYPES = new Set(["transfer", "exchange", "topup"]);

/**
 * True for Transfers, Exchanges and Top-ups — internal movements between pockets,
 * currencies or from external sources rather than merchant spending. The CSV import
 * page offers a toggle to skip these so the spending module sees only real expenses.
 */
export function isInternalMovement(tx: RevolutTransaction): boolean {
  return INTERNAL_TYPES.has((tx.type || "").toLowerCase());
}

/** Rounds to 2 decimal places, avoiding binary float drift (e.g. 10.005 → 10.01). */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** FNV-1a string hash → short hex, for a stable opening-balance id. */
function hash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Builds an "Opening balance" activity that seeds the money already in the account
 * before the statement's first row.
 *
 * Revolut's CSV only lists movements within the statement period, so summing the
 * imported DEPOSIT/WITHDRAWAL/FEE activities reproduces the *net flow*, not the real
 * ending balance — the account is short by whatever it held on day one. We recover
 * that opening balance from the earliest row's `Balance` column (which is the running
 * balance *after* that row) by reversing the row's own effect:
 *
 *   balanceAfter = opening + amount − fee   ⇒   opening = balanceAfter − amount + fee
 *
 * Returns `null` when the opening balance can't be derived (no Balance column) or is
 * zero (nothing to seed). The id, day and comment are deterministic, so re-importing
 * the same statement reproduces the identical row and the host de-dupes it cleanly.
 *
 * Caveat: this assumes a single statement covering the account's start. Importing a
 * second statement that begins *earlier* would seed a second, different opening balance.
 */
export function openingBalanceActivity(
  transactions: RevolutTransaction[],
  wealthfolioAccountId: string,
): ActivityImport | null {
  if (transactions.length === 0) return null;

  // Earliest row by date — the CSV is usually oldest-first, but don't rely on order.
  const earliest = transactions.reduce((a, b) => (a.date <= b.date ? a : b));
  if (earliest.balance === null) return null;

  const opening = round2(earliest.balance - earliest.amount + earliest.fee);
  if (opening === 0) return null;

  const currency = earliest.currency || "GBP";
  // Date the seed at the start of the earliest transaction's day so it precedes every
  // movement and lands on a stable, re-import-deterministic day.
  const day = String(earliest.date).slice(0, 10);
  const date = `${day}T00:00:00.000Z`;

  return {
    id: `revolut-opening-${hash(`${currency}|${opening}|${day}`)}`,
    accountId: wealthfolioAccountId,
    activityType: opening >= 0 ? DEPOSIT : WITHDRAWAL,
    date,
    amount: Math.abs(opening),
    currency,
    symbol: `$CASH-${currency}`,
    isValid: true,
    isDraft: false,
    comment: "Opening balance",
  };
}

/**
 * Maps a Revolut transaction to one or more Wealthfolio activities.
 *
 * The sign of the amount picks DEPOSIT (credit) vs WITHDRAWAL (debit), mirroring the
 * Monzo addon. The merchant description is passed through as the comment so
 * Wealthfolio's spending module can categorise it. When Revolut charged a separate
 * fee, a second FEE activity is emitted (with a derived `-fee` id) so the cash
 * balance stays accurate when importing every row.
 */
export function mapTransactionToActivity(
  tx: RevolutTransaction,
  wealthfolioAccountId: string,
): ActivityImport[] {
  const currency = tx.currency || "GBP";
  // Cash activities (DEPOSIT/WITHDRAWAL/FEE) are cash-only and never reference a
  // tradable asset. Wealthfolio represents the cash leg with the synthetic
  // `$CASH-<CCY>` symbol (priced at 1.0); using a bare currency code like "GBP"
  // makes the host treat it as a security and value it via an FX quote, which
  // produces wildly inflated account totals.
  const symbol = `$CASH-${currency}`;

  const activities: ActivityImport[] = [
    {
      id: tx.id,
      accountId: wealthfolioAccountId,
      activityType: tx.amount >= 0 ? DEPOSIT : WITHDRAWAL,
      date: tx.date,
      amount: round2(Math.abs(tx.amount)),
      currency,
      symbol,
      isValid: true,
      isDraft: false,
      comment: tx.description || undefined,
    },
  ];

  if (tx.fee && tx.fee !== 0) {
    activities.push({
      id: `${tx.id}-fee`,
      accountId: wealthfolioAccountId,
      activityType: FEE,
      date: tx.date,
      amount: round2(Math.abs(tx.fee)),
      currency,
      symbol,
      isValid: true,
      isDraft: false,
      comment: "Revolut fee",
    });
  }

  return activities;
}

/** Minimal shape of an already-imported activity, as returned by `activities.getAll`. */
export interface ExistingActivity {
  activityType: string;
  date: Date | string;
  amount: number | string | null;
  comment?: string | null;
}

/** The merge key Wealthfolio collapses on at import time: day, type, amount (to 2dp), comment. */
function dedupKey(
  activityType: string,
  date: Date | string,
  amount: number | string | null | undefined,
  comment: string | null | undefined,
): string {
  const iso = date instanceof Date ? date.toISOString() : String(date);
  const day = iso.slice(0, 10);
  const amt = Number(amount ?? 0).toFixed(2);
  return `${day}|${activityType}|${amt}|${comment ?? ""}`;
}

/**
 * Picks the activities that aren't already in the account, so re-imports add nothing while
 * genuinely repeated transactions all land.
 *
 * Wealthfolio's import silently merges any two activities sharing (account, calendar day, type,
 * amount) — it ignores both the comment and our `id`. So two distinct transactions on the same
 * day for the same amount (e.g. two £1000 "Withdrawing savings") collapse into one, dropping real
 * money. The import call therefore runs with `forceImport` to bypass that merge — which means we
 * must supply idempotency ourselves, or a second import of the same file would double everything.
 *
 * This reconciles by *count* per (day, type, amount, comment): if the account already holds N rows
 * for a key, the first N desired rows for that key are skipped and the rest are kept. Re-importing
 * the same statement yields an empty set; importing an overlapping/extended statement adds only the
 * surplus. It does not depend on the host preserving our `id`.
 */
export function selectNewActivities(
  desired: ActivityImport[],
  existing: ExistingActivity[],
): ActivityImport[] {
  const have = new Map<string, number>();
  for (const e of existing) {
    const k = dedupKey(e.activityType, e.date, e.amount, e.comment);
    have.set(k, (have.get(k) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const out: ActivityImport[] = [];
  for (const a of desired) {
    const k = dedupKey(a.activityType, a.date ?? "", a.amount, a.comment);
    const idx = seen.get(k) ?? 0;
    seen.set(k, idx + 1);
    if (idx >= (have.get(k) ?? 0)) out.push(a);
  }
  return out;
}
