import { describe, it, expect } from "vitest";
import { ChainState } from "./state.js";

function fresh(): ChainState {
  const c = new ChainState();
  c.bootstrap();
  return c;
}

function labBalance(c: ChainState): bigint {
  let total = 0n;
  for (const k of c.labWalletUtxos) {
    const u = c.utxos.get(k);
    if (u && !u.spent) total += u.amountSat;
  }
  return total;
}

describe("ChainState.labSend", () => {
  it("leaves the lab wallet untouched when funds are insufficient", () => {
    const c = fresh();
    const before = labBalance(c);
    const beforeCount = c.labWalletUtxos.length;

    expect(() => c.labSend(c.newAddress(), before + 1n)).toThrow(
      "lab wallet exhausted",
    );
    expect(labBalance(c)).toBe(before);
    expect(c.labWalletUtxos.length).toBe(beforeCount);

    // A normal send still succeeds afterwards.
    const txid = c.labSend(c.newAddress(), 100_000_000n);
    expect(c.mempool.has(txid)).toBe(true);
  });

  it("returns change to the lab wallet and charges exactly the fee", () => {
    const c = fresh();
    const before = labBalance(c);
    const txid = c.labSend(c.newAddress(), 250_000_000n);
    const tx = c.mempool.get(txid)!;
    expect(tx.outputs).toHaveLength(2);
    expect(labBalance(c)).toBe(before - 250_000_000n - tx.feeSat);
  });
});

describe("ChainState.rbfReplace", () => {
  it("redirects the recipient, preserves lab-wallet change, and drops the original txid", () => {
    const c = fresh();
    const victim = c.newAddress();
    const attacker = c.newAddress();
    const before = labBalance(c);

    const oldTxid = c.labSend(victim, 500_000_000n);
    const old = c.mempool.get(oldTxid)!;
    const changeSat = old.outputs[1]!.amountSat;

    const newTxid = c.rbfReplace(oldTxid, attacker);
    const repl = c.mempool.get(newTxid)!;

    // Original vanishes from the victim's watch view and reports -1.
    expect(c.txsToAddress(victim)).toHaveLength(0);
    expect(c.confirmations(oldTxid)).toBe(-1);

    // Recipient pays the bump; change is unchanged and still owned by the lab wallet.
    expect(repl.outputs[0]).toEqual({ address: attacker, amountSat: 500_000_000n - 500n });
    expect(repl.outputs[1]).toEqual({ address: c.labWalletAddress, amountSat: changeSat });
    expect(repl.feeSat).toBe(old.feeSat + 500n);
    expect(labBalance(c)).toBe(before - 500_000_000n - old.feeSat);

    // Change remains spendable from the lab wallet.
    expect(c.labWalletUtxos).toContain(`${newTxid}:1`);
  });
});
