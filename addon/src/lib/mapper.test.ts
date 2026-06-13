import { describe, expect, it } from "vitest";
import type { ActivityImport } from "@wealthfolio/addon-sdk";
import {
  mapTransactionToActivity,
  mapType,
  openingBalanceActivity,
  selectNewActivities,
} from "./mapper";
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
    balance: 799,
    ...overrides,
  };
}

describe("mapType", () => {
  it("maps card payments and ATM withdrawals to DEPOSIT/WITHDRAWAL by sign", () => {
    expect(mapType("Card Payment", -10.71)).toBe("WITHDRAWAL");
    expect(mapType("ATM", -20)).toBe("WITHDRAWAL");
    expect(mapType("Card Refund", 5)).toBe("DEPOSIT");
  });

  it("maps transfers and exchanges to TRANSFER_IN/OUT by sign", () => {
    expect(mapType("Transfer", -100)).toBe("TRANSFER_OUT");
    expect(mapType("Transfer", 100)).toBe("TRANSFER_IN");
    expect(mapType("Exchange", -85.46)).toBe("TRANSFER_OUT");
    expect(mapType("Exchange", 99.2)).toBe("TRANSFER_IN");
  });

  it("maps top-ups to DEPOSIT (incoming funding / income, not spending)", () => {
    expect(mapType("Topup", 4902.25)).toBe("DEPOSIT");
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

  it("maps a top-up to a DEPOSIT", () => {
    const [a] = mapTransactionToActivity(
      tx({ type: "Topup", description: "Payment from UNIVERSITY OF SHEF", amount: 4902.25 }),
      "acc-1",
    );
    expect(a.activityType).toBe("DEPOSIT");
    expect(a.amount).toBe(4902.25);
  });

  it("maps an exchange leg to a TRANSFER_OUT (kept in balance, out of spending)", () => {
    const [a] = mapTransactionToActivity(
      tx({ type: "Exchange", description: "Exchanged to EUR", amount: -85.46 }),
      "acc-1",
    );
    expect(a.activityType).toBe("TRANSFER_OUT");
    expect(a.amount).toBe(85.46);
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

describe("openingBalanceActivity", () => {
  it("recovers the opening balance from the earliest row's Balance column", () => {
    // Earliest row: balance after = 799, amount = -10.71, fee = 0
    //   opening = 799 - (-10.71) + 0 = 809.71
    const a = openingBalanceActivity(
      [
        tx({ date: "2021-09-18T01:25:56.000Z", amount: -10.71, balance: 799 }),
        tx({ date: "2021-09-30T17:08:08.000Z", amount: 4902.25, balance: 5701.25 }),
      ],
      "acc-1",
    );
    expect(a).toMatchObject({
      accountId: "acc-1",
      activityType: "DEPOSIT",
      amount: 809.71,
      currency: "GBP",
      symbol: "$CASH-GBP",
      comment: "Opening balance",
      date: "2021-09-18T00:00:00.000Z",
    });
  });

  it("reverses the fee as well as the amount", () => {
    // opening = balance - amount + fee = 3130.41 - (-85.46) + 0.43 = 3216.30
    const a = openingBalanceActivity(
      [tx({ amount: -85.46, fee: 0.43, balance: 3130.41 })],
      "acc-1",
    );
    expect(a?.amount).toBe(3216.3);
  });

  it("emits a WITHDRAWAL when the account opened overdrawn", () => {
    // opening = -50 - (-10) + 0 = -40
    const a = openingBalanceActivity([tx({ amount: -10, balance: -50 })], "acc-1");
    expect(a).toMatchObject({ activityType: "WITHDRAWAL", amount: 40 });
  });

  it("returns null when the opening balance is zero (nothing to seed)", () => {
    // opening = 10 - 10 + 0 = 0
    const a = openingBalanceActivity([tx({ amount: 10, balance: 10 })], "acc-1");
    expect(a).toBeNull();
  });

  it("returns null when the earliest row has no balance", () => {
    expect(openingBalanceActivity([tx({ balance: null })], "acc-1")).toBeNull();
    expect(openingBalanceActivity([], "acc-1")).toBeNull();
  });

  it("is deterministic across re-imports of the same statement", () => {
    const rows = [tx({ date: "2021-09-18T01:25:56.000Z", balance: 799 })];
    expect(openingBalanceActivity(rows, "acc-1")?.id).toBe(
      openingBalanceActivity(rows, "acc-1")?.id,
    );
  });

  it("seeds so opening + net movements equals the final balance, across all cash types", () => {
    // Mixes a transfer, an exchange leg and a fee to prove TRANSFER_*/FEE all reconcile.
    const rows = [
      tx({ date: "2021-09-18T01:25:56.000Z", amount: -10.71, balance: 799 }), // WITHDRAWAL
      tx({ type: "Topup", date: "2021-09-30T17:08:08.000Z", amount: 4902.25, balance: 5701.25 }), // DEPOSIT
      tx({ type: "Transfer", date: "2021-10-01T09:00:00.000Z", amount: -200, balance: 5501.25 }), // TRANSFER_OUT
      tx({ type: "Exchange", date: "2021-10-02T09:00:00.000Z", amount: -85.46, fee: 0.43, balance: 5415.36 }), // TRANSFER_OUT + FEE
    ];
    const opening = openingBalanceActivity(rows, "acc-1");
    const credits = new Set(["DEPOSIT", "TRANSFER_IN"]);
    const signed = (a: { activityType: string; amount: number }) =>
      credits.has(a.activityType) ? a.amount : -a.amount;
    const movements = rows.flatMap((t) => mapTransactionToActivity(t, "acc-1"));
    const total =
      signed(opening as { activityType: string; amount: number }) +
      movements.reduce((s, m) => s + signed(m as { activityType: string; amount: number }), 0);
    expect(Math.round(total * 100) / 100).toBe(5415.36);
  });
});

describe("selectNewActivities", () => {
  function act(over: Partial<ActivityImport> = {}): ActivityImport {
    return {
      id: "x",
      accountId: "acc-1",
      activityType: "DEPOSIT",
      date: "2022-09-16T10:00:43.000Z",
      amount: 1000,
      currency: "GBP",
      symbol: "$CASH-GBP",
      isValid: true,
      isDraft: false,
      comment: "Withdrawing savings",
      ...over,
    } as ActivityImport;
  }

  it("keeps both genuinely-distinct same-day/type/amount rows when nothing exists yet", () => {
    const out = selectNewActivities(
      [act({ date: "2022-09-16T10:00:43.000Z" }), act({ date: "2022-09-16T15:50:29.000Z" })],
      [],
    );
    expect(out).toHaveLength(2);
  });

  it("adds nothing on a re-import (account already holds both)", () => {
    const desired = [act({ date: "2022-09-16T10:00:43.000Z" }), act({ date: "2022-09-16T15:50:29.000Z" })];
    const existing = [
      { activityType: "DEPOSIT", date: "2022-09-16T00:00:00.000Z", amount: "1000", comment: "Withdrawing savings" },
      { activityType: "DEPOSIT", date: "2022-09-16T00:00:00.000Z", amount: "1000", comment: "Withdrawing savings" },
    ];
    expect(selectNewActivities(desired, existing)).toHaveLength(0);
  });

  it("imports only the surplus when the account holds some but not all", () => {
    const desired = [act(), act(), act()]; // 3 identical-key rows
    const existing = [
      { activityType: "DEPOSIT", date: "2022-09-16T00:00:00.000Z", amount: 1000, comment: "Withdrawing savings" },
    ];
    expect(selectNewActivities(desired, existing)).toHaveLength(2);
  });

  it("treats different days/amounts/types/comments as distinct keys", () => {
    const desired = [
      act({ date: "2022-09-16T10:00:43.000Z" }),
      act({ date: "2022-12-01T10:00:43.000Z" }), // different day
      act({ amount: 90 }), // different amount
      act({ activityType: "WITHDRAWAL" }), // different type
      act({ comment: "Tesco" }), // different comment
    ];
    expect(selectNewActivities(desired, [])).toHaveLength(5);
  });

  it("handles existing rows whose date is a Date object", () => {
    const desired = [act({ date: "2022-09-16T10:00:43.000Z" })];
    const existing = [
      { activityType: "DEPOSIT", date: new Date("2022-09-16T00:00:00.000Z"), amount: 1000, comment: "Withdrawing savings" },
    ];
    expect(selectNewActivities(desired, existing)).toHaveLength(0);
  });
});
