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

  const activities: ActivityImport[] = [
    {
      id: tx.id,
      accountId: wealthfolioAccountId,
      activityType: tx.amount >= 0 ? DEPOSIT : WITHDRAWAL,
      date: tx.date,
      amount: round2(Math.abs(tx.amount)),
      currency,
      symbol: currency,
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
      symbol: currency,
      isValid: true,
      isDraft: false,
      comment: "Revolut fee",
    });
  }

  return activities;
}
