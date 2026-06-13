import { describe, expect, it } from "vitest";
import { parseRevolutCsv } from "./csv-parser";

const HEADER =
  "Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance";

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join("\n");
}

describe("parseRevolutCsv", () => {
  it("parses a completed card payment (debit)", () => {
    const txs = parseRevolutCsv(
      csv("Card Payment,Current,2021-09-17 14:00:36,2021-09-18 1:25:56,Trainline,-10.71,0,GBP,COMPLETED,799"),
    );
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({
      type: "Card Payment",
      description: "Trainline",
      amount: -10.71,
      fee: 0,
      currency: "GBP",
      state: "COMPLETED",
    });
  });

  it("normalises single-digit hours into a valid ISO timestamp", () => {
    const [tx] = parseRevolutCsv(
      csv("Card Payment,Current,2021-09-17 14:00:36,2021-09-18 1:25:56,Trainline,-10.71,0,GBP,COMPLETED,799"),
    );
    expect(tx.date).toBe("2021-09-18T01:25:56.000Z");
    expect(new Date(tx.date).toISOString()).toBe("2021-09-18T01:25:56.000Z");
  });

  it("keeps amounts in major units (no pence conversion)", () => {
    const [tx] = parseRevolutCsv(
      csv("Topup,Current,2021-09-30 17:08:08,2021-09-30 17:08:08,Payment from UNIVERSITY OF SHEF,4902.25,0,GBP,COMPLETED,5690.15"),
    );
    expect(tx.amount).toBe(4902.25);
  });

  it("captures the separate fee column", () => {
    const [tx] = parseRevolutCsv(
      csv("Exchange,Current,2021-11-08 21:38:09,2021-11-08 21:38:09,Exchanged to EUR,-85.46,0.43,GBP,COMPLETED,3130.41"),
    );
    expect(tx.fee).toBe(0.43);
  });

  it("drops non-completed and zero-amount rows", () => {
    const txs = parseRevolutCsv(
      csv(
        "Card Payment,Current,2021-09-17 14:00:36,2021-09-18 1:25:56,Pending Shop,-5,0,GBP,PENDING,794",
        "Card Payment,Current,2021-09-17 14:00:36,2021-09-18 1:25:56,Declined Shop,-5,0,GBP,DECLINED,794",
        "Card Payment,Current,2021-09-17 14:00:36,2021-09-18 1:25:56,Reverted Shop,-5,0,GBP,REVERTED,794",
        "Card Payment,Current,2021-09-17 14:00:36,2021-09-18 1:25:56,Zero,0,0,GBP,COMPLETED,794",
      ),
    );
    expect(txs).toHaveLength(0);
  });

  it("produces a stable, currency-scoped, unique id per row", () => {
    const row =
      "Card Payment,Current,2021-09-17 14:00:36,2021-09-18 1:25:56,Trainline,-10.71,0,GBP,COMPLETED,799";
    const a = parseRevolutCsv(csv(row))[0];
    const b = parseRevolutCsv(csv(row))[0];
    expect(a.id).toBe(b.id);
    expect(a.id).toMatch(/^revolut-GBP-[0-9a-f]{8}$/);

    // Two different rows must not collide.
    const other = parseRevolutCsv(
      csv("Card Payment,Current,2021-09-23 14:47:25,2021-09-24 6:50:19,Uber,-3.85,0,GBP,COMPLETED,795.15"),
    )[0];
    expect(other.id).not.toBe(a.id);
  });

  it("parses a mixed-currency statement, tagging each row's currency", () => {
    const txs = parseRevolutCsv(
      csv(
        "Card Payment,Current,2021-09-17 14:00:36,2021-09-18 1:25:56,Trainline,-10.71,0,GBP,COMPLETED,799",
        "Card Payment,Current,2021-10-01 10:00:00,2021-10-01 10:00:00,Carrefour,-12.30,0,EUR,COMPLETED,200",
        "Card Payment,Current,2021-10-02 10:00:00,2021-10-02 10:00:00,Amazon,-5.00,0,USD,COMPLETED,50",
      ),
    );
    expect(txs.map((t) => t.currency)).toEqual(["GBP", "EUR", "USD"]);
    expect(txs[1].id).toMatch(/^revolut-EUR-/);
  });

  it("captures the running balance as a number (for opening-balance recovery)", () => {
    const [tx] = parseRevolutCsv(
      csv("Card Payment,Current,2021-09-17 14:00:36,2021-09-18 1:25:56,Trainline,-10.71,0,GBP,COMPLETED,799"),
    );
    expect(tx.balance).toBe(799);
  });

  it("sets balance to null when the Balance column is missing or blank", () => {
    const [tx] = parseRevolutCsv(
      csv("Card Payment,Current,2021-09-17 14:00:36,2021-09-18 1:25:56,Trainline,-10.71,0,GBP,COMPLETED,"),
    );
    expect(tx.balance).toBeNull();
  });

  it("returns an empty array for an empty or header-only file", () => {
    expect(parseRevolutCsv("")).toEqual([]);
    expect(parseRevolutCsv(HEADER)).toEqual([]);
  });

  it("matches columns by header name even if order changes", () => {
    const reordered = [
      "Started Date,Completed Date,Type,Product,Description,Currency,Amount,Fee,State,Balance",
      "2021-09-17 14:00:36,2021-09-18 1:25:56,Card Payment,Current,Trainline,GBP,-10.71,0,COMPLETED,799",
    ].join("\n");
    const [tx] = parseRevolutCsv(reordered);
    expect(tx).toMatchObject({ type: "Card Payment", description: "Trainline", amount: -10.71 });
  });
});
