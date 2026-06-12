import { describe, expect, it } from "vitest";
import { isInternalMovement, mapTransactionToActivity } from "./mapper";
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
      symbol: "GBP",
      comment: "Trainline",
    });
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
      comment: "Revolut fee",
    });
  });

  it("does not emit a fee activity when there is no fee", () => {
    const activities = mapTransactionToActivity(tx({ fee: 0 }), "acc-1");
    expect(activities).toHaveLength(1);
  });
});
