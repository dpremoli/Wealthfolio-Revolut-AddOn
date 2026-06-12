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

/**
 * Wealthfolio de-duplicates imported activities on (account, calendar day, type, amount,
 * comment) — it truncates the timestamp to the day and ignores our `id`. So two genuinely
 * distinct transactions that share the same day, type, amount and description (e.g. two £1000
 * "Withdrawing savings" on one day, or a duplicated "Trainline" charge) get silently merged on
 * import, dropping real money from the balance.
 *
 * This appends a deterministic occurrence counter to the comment of the 2nd+ activities that
 * collide on that exact key, so the host sees them as distinct. The first member is left
 * untouched, so almost every comment is unchanged. It is order-deterministic (the activity list
 * follows CSV order), so re-importing the same statement reproduces identical comments and the
 * host still de-dupes correctly — no `forceImport` needed.
 */
export function disambiguateComments(activities: ActivityImport[]): ActivityImport[] {
  const counts = new Map<string, number>();
  return activities.map((a) => {
    const day = String(a.date).slice(0, 10);
    const key = `${day}|${a.activityType}|${a.amount}|${a.comment ?? ""}`;
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    if (n === 1) return a;
    const base = a.comment ?? "";
    return { ...a, comment: base ? `${base} (${n})` : `(${n})` };
  });
}
