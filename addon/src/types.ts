/**
 * A single Revolut statement row, normalised from the CSV export.
 *
 * Revolut's personal statement has no public/free API (the Open Banking API is
 * partner-only and the Business API covers business accounts), so the CSV export
 * is the only source. Unlike Monzo, the CSV carries no transaction ID and no
 * category column — we derive a stable `id` ourselves (see `csv-parser.ts`) and
 * leave categorisation to Wealthfolio's spending module.
 */
export interface RevolutTransaction {
  /** Deterministic dedup key derived from the row (no native ID in the CSV). */
  id: string;
  /** Revolut transaction type, e.g. "Card Payment", "Transfer", "Exchange", "Topup". */
  type: string;
  /** Settlement timestamp as ISO 8601 (prefers Completed Date, falls back to Started Date). */
  date: string;
  /** Merchant name / payee description, e.g. "Uber Eats", "Tesco". */
  description: string;
  /** Signed amount in major units (negative = debit, positive = credit). */
  amount: number;
  /** Separate Revolut fee in major units (0 when none). */
  fee: number;
  /** ISO currency code, e.g. "GBP". */
  currency: string;
  /** Revolut state, e.g. "COMPLETED", "PENDING", "REVERTED", "DECLINED". */
  state: string;
  /** Revolut product, e.g. "Current", "Savings". */
  product: string;
}
