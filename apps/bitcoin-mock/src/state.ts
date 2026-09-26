// In-memory chain state for the mock regtest node.
//
// Tracks: a UTXO set (per (txid, vout)), a mempool, a chain of
// blocks (sequence of txids per block), and a pre-funded "lab
// wallet" that holds spendable UTXOs trainees can `sendtoaddress`
// from.

import { randomBytes } from "node:crypto";

export type Utxo = {
  txid: string;
  vout: number;
  address: string;
  amountSat: bigint;
  spent: boolean;
};

export type MempoolTx = {
  txid: string;
  inputs: Array<{ txid: string; vout: number }>;
  outputs: Array<{ address: string; amountSat: bigint }>;
  feeSat: bigint;
  replaceable: boolean;
};

export type ConfirmedTx = MempoolTx & {
  blockHeight: number;
  blockHash: string;
};

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

// bech32 data charset (no b, i, o, 1). Used by `newAddress` so the
// emitted strings pass the shared `isValidBtcAddress` HRP+charset
// gate when Phase 7+ defensively round-trips them.
const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function bech32Random(n: number): string {
  const buf = randomBytes(n);
  let out = "";
  for (let i = 0; i < n; i++) {
    out += BECH32_CHARSET[(buf[i] as number) & 31];
  }
  return out;
}

export class ChainState {
  blockHeight = 0;
  bestBlockHash = "0".repeat(64);
  // utxos keyed by `${txid}:${vout}`
  utxos = new Map<string, Utxo>();
  // mempool keyed by txid
  mempool = new Map<string, MempoolTx>();
  // confirmed tx history keyed by txid (only TXs we have explicitly
  // produced are tracked here; deep history isn't relevant for the lab)
  confirmed = new Map<string, ConfirmedTx>();
  // tx that have been RBF-replaced and should report -1 confirmations
  dropped = new Set<string>();
  // pre-funded lab wallet
  labWalletUtxos: string[] = []; // keys into `utxos`
  labWalletAddress = "bcrt1qlabxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";

  bootstrap(): void {
    if (this.blockHeight > 0) return;
    // Mint 10 coinbase outputs of 1,000 BTC each (= 100,000,000,000 sats).
    for (let i = 0; i < 10; i++) {
      const txid = randomHex(32);
      const utxoKey = `${txid}:0`;
      this.utxos.set(utxoKey, {
        txid,
        vout: 0,
        address: this.labWalletAddress,
        amountSat: 100_000_000_000n,
        spent: false,
      });
      this.labWalletUtxos.push(utxoKey);
      const blockHash = randomHex(32);
      this.confirmed.set(txid, {
        txid,
        inputs: [],
        outputs: [{ address: this.labWalletAddress, amountSat: 100_000_000_000n }],
        feeSat: 0n,
        replaceable: false,
        blockHeight: i + 1,
        blockHash,
      });
      this.blockHeight = i + 1;
      this.bestBlockHash = blockHash;
    }
  }

  newAddress(prefix = "bcrt1q"): string {
    return prefix + bech32Random(32);
  }

  confirmations(txid: string): number {
    if (this.dropped.has(txid)) return -1;
    if (this.mempool.has(txid)) return 0;
    const c = this.confirmed.get(txid);
    if (!c) return -1;
    return this.blockHeight - c.blockHeight + 1;
  }

  /**
   * Send `amountSat` from the lab wallet to `address`. The TX is
   * placed in the mempool (0 conf) and flagged replaceable. Returns
   * the txid.
   */
  labSend(address: string, amountSat: bigint, replaceable = true): string {
    const feeSat = 1_000n;
    const target = amountSat + feeSat;

    // Coin selection is a dry run first: pick keys without touching the
    // wallet so an insufficient-funds error leaves every UTXO spendable.
    let collected = 0n;
    const selected: string[] = [];
    for (const key of this.labWalletUtxos) {
      if (collected >= target) break;
      const u = this.utxos.get(key);
      if (!u || u.spent) continue;
      selected.push(key);
      collected += u.amountSat;
    }
    if (collected < target) throw new Error("lab wallet exhausted");

    const inputs: Array<{ txid: string; vout: number }> = [];
    const selectedSet = new Set(selected);
    for (const key of selected) {
      const u = this.utxos.get(key) as Utxo;
      u.spent = true;
      inputs.push({ txid: u.txid, vout: u.vout });
    }
    // Drop the spent keys (and any stale ones that no longer resolve).
    this.labWalletUtxos = this.labWalletUtxos.filter((k) => {
      if (selectedSet.has(k)) return false;
      const u = this.utxos.get(k);
      return !!u && !u.spent;
    });

    const txid = randomHex(32);
    const changeSat = collected - target;
    const outputs: Array<{ address: string; amountSat: bigint }> = [
      { address, amountSat },
    ];
    if (changeSat > 0n) {
      outputs.push({ address: this.labWalletAddress, amountSat: changeSat });
    }
    this.mempool.set(txid, {
      txid,
      inputs,
      outputs,
      feeSat,
      replaceable,
    });

    // Reflect new UTXOs (still in mempool — will be marked confirmed at next block).
    outputs.forEach((o, i) => {
      const key = `${txid}:${i}`;
      this.utxos.set(key, {
        txid,
        vout: i,
        address: o.address,
        amountSat: o.amountSat,
        spent: false,
      });
      if (o.address === this.labWalletAddress) this.labWalletUtxos.push(key);
    });

    return txid;
  }

  /**
   * RBF-replace a mempool tx with a new one that redirects the
   * recipient output (vout 0) to `newAddress`. Any other outputs
   * (e.g. change back to the lab wallet) are carried over unchanged.
   * The fee bump is taken from the recipient output only. Returns the
   * new txid.
   */
  rbfReplace(oldTxid: string, newAddress: string): string {
    const old = this.mempool.get(oldTxid);
    if (!old) throw new Error("tx not in mempool");
    if (!old.replaceable) throw new Error("tx not replaceable");

    const [recipient, ...rest] = old.outputs;
    if (!recipient) throw new Error("tx has no outputs");
    // Same inputs, fee raised by `bumpSat`; the recipient output absorbs
    // the bump so input_sum - outputs_sum still equals the recorded fee.
    const bumpSat = 500n;
    if (recipient.amountSat <= bumpSat) {
      throw new Error("recipient output too small to bump fee");
    }
    const feeSat = old.feeSat + bumpSat;
    const newOutputs: Array<{ address: string; amountSat: bigint }> = [
      { address: newAddress, amountSat: recipient.amountSat - bumpSat },
      ...rest.map((o) => ({ address: o.address, amountSat: o.amountSat })),
    ];

    // Drop the old outputs from utxos (and from the lab wallet's list).
    const oldKeys = new Set(old.outputs.map((_, i) => `${oldTxid}:${i}`));
    oldKeys.forEach((k) => this.utxos.delete(k));
    this.labWalletUtxos = this.labWalletUtxos.filter((k) => !oldKeys.has(k));
    this.mempool.delete(oldTxid);
    this.dropped.add(oldTxid);

    const replacementTxid = randomHex(32);
    this.mempool.set(replacementTxid, {
      txid: replacementTxid,
      inputs: old.inputs,
      outputs: newOutputs,
      feeSat,
      replaceable: true,
    });
    newOutputs.forEach((o, i) => {
      const key = `${replacementTxid}:${i}`;
      this.utxos.set(key, {
        txid: replacementTxid,
        vout: i,
        address: o.address,
        amountSat: o.amountSat,
        spent: false,
      });
      // Re-register lab-wallet outputs (change) so the wallet keeps its funds.
      if (o.address === this.labWalletAddress) this.labWalletUtxos.push(key);
    });
    return replacementTxid;
  }

  /**
   * Admit a raw transaction synthesised externally (e.g. by the
   * treasury PSBT pipeline). Outputs are credited to the chain's
   * UTXO set; inputs are not tracked here because the treasury
   * pipeline doesn't carry forward UTXO selection beyond the PSBT.
   */
  admitRawTx(txid: string, outputs: Array<{ address: string; amountSat: bigint }>): void {
    this.mempool.set(txid, {
      txid,
      inputs: [],
      outputs,
      feeSat: 0n,
      replaceable: true,
    });
    outputs.forEach((o, i) => {
      this.utxos.set(`${txid}:${i}`, {
        txid,
        vout: i,
        address: o.address,
        amountSat: o.amountSat,
        spent: false,
      });
    });
  }

  mineBlocks(n: number): string[] {
    const hashes: string[] = [];
    for (let i = 0; i < n; i++) {
      this.blockHeight += 1;
      const blockHash = randomHex(32);
      this.bestBlockHash = blockHash;
      // Move mempool into confirmed for this block.
      for (const [txid, tx] of this.mempool.entries()) {
        this.confirmed.set(txid, {
          ...tx,
          blockHeight: this.blockHeight,
          blockHash,
        });
        this.mempool.delete(txid);
      }
      hashes.push(blockHash);
    }
    return hashes;
  }

  /** List TXs in mempool + recent blocks paying `address`. */
  txsToAddress(
    address: string,
  ): Array<{ txid: string; vout: number; amountSat: bigint; inMempool: boolean }> {
    const out: Array<{
      txid: string;
      vout: number;
      amountSat: bigint;
      inMempool: boolean;
    }> = [];
    for (const tx of this.mempool.values()) {
      tx.outputs.forEach((o, i) => {
        if (o.address === address) {
          out.push({ txid: tx.txid, vout: i, amountSat: o.amountSat, inMempool: true });
        }
      });
    }
    for (const tx of this.confirmed.values()) {
      tx.outputs.forEach((o, i) => {
        if (o.address === address) {
          out.push({ txid: tx.txid, vout: i, amountSat: o.amountSat, inMempool: false });
        }
      });
    }
    return out;
  }
}

export const chain = new ChainState();
chain.bootstrap();
