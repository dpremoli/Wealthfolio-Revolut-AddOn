import { describe, expect, it } from "vitest";
import type { ActivityImport } from "@wealthfolio/addon-sdk";
import { disambiguateComments, isInternalMovement, mapTransactionToActivity } from "./mapper";
import type { RevolutTransaction } from "../types";

function tx(overrides: Partial<RevolutTransaction> = {}): RevolutTransaction {
  return {
    id: "revolut-deadbeef",
    type: "Card Payment",
    date: "2021-09-18T01:25:56.000Z",
    description: "Trainline",
    amount: -10.71,
    fee: 0,
    currency: "GBP",
    state: "COMPLETED",
    product: "Current",
    ...overrides,
  };
}

describe("isInternalMovement", () => {
  it("flags transfers, exchanges and top-ups", () => {
    expect(isInternalMovement(tx({ type: "Transfer" }))).toBe(true);
    expect(isInternalMovement(tx({ type: "Exchange" }))).toBe(true);
    expect(isInternalMovement(tx({ type: "Topup" }))).toBe(true);
  });

  it("does not flag card payments or ATM withdrawals", () => {
    expect(isInternalMovement(tx({ type: "Card Payment" }))).toBe(false);
    expect(isInternalMovement(tx({ type: "ATM" }))).toBe(false);
  });
});

describe("mapTransactionToActivity", () => {
  it("maps a debit to a WITHDRAWAL with the merchant as the comment", () => {
    const [a] = mapTransactionToActivity(tx(), "acc-1");
    expect(a).toMatchObject({
      id: "revolut-deadbeef",
      accountId: "acc-1",
      activityType: "WITHDRAWAL",
      amount: 10.71,
      currency: "GBP",
      symbol: "$CASH-GBP",
      comment: "Trainline",
    });
  });

  it("uses the synthetic $CASH-<CCY> symbol so totals are not FX-inflated", () => {
    const [gbp] = mapTransactionToActivity(tx({ currency: "GBP" }), "acc-1");
    const [eur] = mapTransactionToActivity(tx({ currency: "EUR" }), "acc-1");
    expect(gbp.symbol).toBe("$CASH-GBP");
    expect(eur.symbol).toBe("$CASH-EUR");
  });

  it("maps a credit to a DEPOSIT", () => {
    const [a] = mapTransactionToActivity(
      tx({ type: "Topup", description: "Payment from UNIVERSITY OF SHEF", amount: 4902.25 }),
      "acc-1",
    );
    expect(a.activityType).toBe("DEPOSIT");
    expect(a.amount).toBe(4902.25);
  });

  it("emits a separate FEE activity when a fee is charged", () => {
    const activities = mapTransactionToActivity(
      tx({ type: "Exchange", description: "Exchanged to EUR", amount: -85.46, fee: 0.43 }),
      "acc-1",
    );
    expect(activities).toHaveLength(2);
    expect(activities[1]).toMatchObject({
      id: "revolut-deadbeef-fee",
      activityType: "FEE",
      amount: 0.43,
      symbol: "$CASH-GBP",
      comment: "Revolut fee",
    });
  });

  it("does not emit a fee activity when there is no fee", () => {
    const activities = mapTransactionToActivity(tx({ fee: 0 }), "acc-1");
    expect(activities).toHaveLength(1);
  });
});

describe("disambiguateComments", () => {
  function act(over: Partial<ActivityImport> = {}): ActivityImport {
    return {
      id: "x",
      accountId: "acc-1",
      activityType: "WITHDRAWAL",
      date: "2022-12-01T10:00:43.000Z",
      amount: 1000,
      currency: "GBP",
      symbol: "$CASH-GBP",
      isValid: true,
      isDraft: false,
      comment: "Withdrawing savings",
      ...over,
    } as ActivityImport;
  }

  it("suffixes 2nd+ activities that share day/type/amount/comment (the WF merge key)", () => {
    const out = disambiguateComments([
      act({ date: "2022-12-01T10:00:43.000Z" }),
      act({ date: "2022-12-01T11:50:29.000Z" }), // same day/type/amount/comment, later time
    ]);
    expect(out[0].comment).toBe("Withdrawing savings");
    expect(out[1].comment).toBe("Withdrawing savings (2)");
  });

  it("leaves same-day/amount rows alone when the description differs", () => {
    const out = disambiguateComments([
      act({ comment: "Tesco", amount: 2.9 }),
      act({ comment: "Sainsbury's", amount: 2.9 }),
    ]);
    expect(out.map((a) => a.comment)).toEqual(["Tesco", "Sainsbury's"]);
  });

  it("does not collide across different days, amounts, or types", () => {
    const out = disambiguateComments([
      act({ date: "2022-09-16T00:02:19.000Z" }),
      act({ date: "2022-12-01T10:00:43.000Z" }), // different day
      act({ amount: 90 }), // different amount
      act({ activityType: "DEPOSIT" }), // different type
    ]);
    expect(out.every((a) => a.comment === "Withdrawing savings")).toBe(true);
  });

  it("keeps the signed total unchanged (it only edits comments)", () => {
    const before = [act(), act({ date: "2022-12-01T11:50:29.000Z" })];
    const after = disambiguateComments(before);
    const sum = (xs: ActivityImport[]) => xs.reduce((t, a) => t + (a.amount as number), 0);
    expect(sum(after)).toBe(sum(before));
  });

  it("disambiguates colliding FEE legs too", () => {
    const out = disambiguateComments([
      act({ activityType: "FEE", amount: 0.43, comment: "Revolut fee" }),
      act({
        activityType: "FEE",
        amount: 0.43,
        comment: "Revolut fee",
        date: "2022-12-01T15:00:00.000Z",
      }),
    ]);
    expect(out[1].comment).toBe("Revolut fee (2)");
  });
});
