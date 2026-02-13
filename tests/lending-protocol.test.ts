import { describe, expect, it, beforeEach } from "vitest";

const CONTRACT = "btc-lending-protocol";
const ONE_STX = 1_000_000;

let deployer: string;
let user: string;
let liquidator: string;

beforeEach(() => {
  const accounts = simnet.getAccounts();
  deployer = accounts.get("deployer")!;
  user = accounts.get("wallet_1")!;
  liquidator = accounts.get("wallet_2")!;
});

/* --------------------------
   Helper Functions
--------------------------- */

function setPrice(price: number) {
  return simnet.mineBlock([
    simnet.callPublicFn(
      CONTRACT,
      "update-btc-price",
      [Cl.uint(price)],
      deployer
    )
  ]);
}

function deposit(amount: number) {
  return simnet.mineBlock([
    simnet.callPublicFn(
      CONTRACT,
      "deposit-collateral",
      [Cl.uint(amount)],
      user
    )
  ]);
}

function borrow(amount: number) {
  return simnet.mineBlock([
    simnet.callPublicFn(
      CONTRACT,
      "borrow",
      [Cl.uint(amount)],
      user
    )
  ]);
}

/* ============================================================
   FULL LENDING PROTOCOL TEST SUITE
============================================================ */

describe("BTC Lending Protocol - Full Suite", () => {

  /* ----------------------------------------------------------
     BORROW TESTS
  ---------------------------------------------------------- */

  it("allows borrowing when collateral ratio is sufficient", () => {
    setPrice(200);
    deposit(2 * ONE_STX);

    const block = borrow(100);
    const receipt = block.receipts[0];

    expect(receipt.result).toBeOk(Cl.bool(true));

    const loan = simnet.callReadOnlyFn(
      CONTRACT,
      "get-loan",
      [Cl.principal(user)],
      user
    );

    expect(loan.result).toBeSome();
  });

  it("fails borrow if insufficient collateral", () => {
    setPrice(100);
    deposit(ONE_STX);

    const block = borrow(1_000_000_000);
    expect(block.receipts[0].result).toBeErr(Cl.uint(103));
  });

  it("fails borrow if price expired", () => {
    setPrice(200);
    deposit(2 * ONE_STX);

    simnet.mineEmptyBlocks(4000);

    const block = borrow(100);
    expect(block.receipts[0].result).toBeErr(Cl.uint(107));
  });

  it("prevents multiple active loans", () => {
    setPrice(200);
    deposit(2 * ONE_STX);

    borrow(100);

    const secondBorrow = borrow(50);
    expect(secondBorrow.receipts[0].result).toBeErr(Cl.uint(105));
  });

  it("rejects zero borrow amount", () => {
    setPrice(200);
    deposit(2 * ONE_STX);

    const block = borrow(0);
    expect(block.receipts[0].result).toBeErr(Cl.uint(102));
  });

  /* ----------------------------------------------------------
     LIQUIDATION TESTS
  ---------------------------------------------------------- */

  it("allows liquidation when collateral ratio falls below threshold", () => {
    setPrice(200);
    deposit(2 * ONE_STX);
    borrow(100);

    // Crash price to trigger liquidation
    setPrice(5);

    const block = simnet.mineBlock([
      simnet.callPublicFn(
        CONTRACT,
        "liquidate",
        [Cl.principal(user)],
        liquidator
      )
    ]);

    expect(block.receipts[0].result).toBeOk(Cl.bool(true));

    const loan = simnet.callReadOnlyFn(
      CONTRACT,
      "get-loan",
      [Cl.principal(user)],
      user
    );

    expect(loan.result).toBeNone();
  });

  it("fails liquidation if position is healthy", () => {
    setPrice(200);
    deposit(2 * ONE_STX);
    borrow(100);

    const block = simnet.mineBlock([
      simnet.callPublicFn(
        CONTRACT,
        "liquidate",
        [Cl.principal(user)],
        liquidator
      )
    ]);

    expect(block.receipts[0].result).toBeErr(Cl.uint(106));
  });

  /* ----------------------------------------------------------
     INTEREST ACCRUAL TEST
  ---------------------------------------------------------- */

  it("accrues interest over time and allows repayment", () => {
    setPrice(200);
    deposit(2 * ONE_STX);
    borrow(1_000);

    simnet.mineEmptyBlocks(500); // simulate time passing

    const block = simnet.mineBlock([
      simnet.callPublicFn(
        CONTRACT,
        "repay-loan",
        [Cl.uint(1_000)],
        user
      )
    ]);

    expect(block.receipts[0].result).toBeOk(Cl.bool(true));
  });

  it("fails repayment if no loan exists", () => {
    const block = simnet.mineBlock([
      simnet.callPublicFn(
        CONTRACT,
        "repay-loan",
        [Cl.uint(100)],
        user
      )
    ]);

    expect(block.receipts[0].result).toBeErr(Cl.uint(104));
  });

  /* ----------------------------------------------------------
     SECURITY & AUTHORIZATION TESTS
  ---------------------------------------------------------- */

  it("rejects unauthorized price update", () => {
    const block = simnet.mineBlock([
      simnet.callPublicFn(
        CONTRACT,
        "update-btc-price",
        [Cl.uint(200)],
        user
      )
    ]);

    expect(block.receipts[0].result).toBeErr(Cl.uint(100));
  });

  it("ensures loan state cleared after liquidation", () => {
    setPrice(200);
    deposit(2 * ONE_STX);
    borrow(100);

    setPrice(5);

    simnet.mineBlock([
      simnet.callPublicFn(
        CONTRACT,
        "liquidate",
        [Cl.principal(user)],
        liquidator
      )
    ]);

    const borrowBalance = simnet.callReadOnlyFn(
      CONTRACT,
      "get-borrow-balance",
      [Cl.principal(user)],
      user
    );

    expect(borrowBalance.result).toBeUint(0);
  });

});
