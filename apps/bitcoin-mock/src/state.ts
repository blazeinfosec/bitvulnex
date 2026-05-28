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

class ChainState {
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
    return prefix + randomHex(16);
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
    let collected = 0n;
    const inputs: Array<{ txid: string; vout: number }> = [];
    while (collected < amountSat + 1_000n && this.labWalletUtxos.length > 0) {
      const key = this.labWalletUtxos.shift();
      if (!key) break;
      const u = this.utxos.get(key);
      if (!u || u.spent) continue;
      u.spent = true;
      collected += u.amountSat;
      inputs.push({ txid: u.txid, vout: u.vout });
    }
    if (collected < amountSat) throw new Error("lab wallet exhausted");

    const txid = randomHex(32);
    const feeSat = 1_000n;
    const changeSat = collected - amountSat - feeSat;
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
   * original amount to `newAddress`. Returns the new txid.
   */
  rbfReplace(oldTxid: string, newAddress: string): string {
    const old = this.mempool.get(oldTxid);
    if (!old) throw new Error("tx not in mempool");
    if (!old.replaceable) throw new Error("tx not replaceable");

    // Drop the old outputs from utxos
    old.outputs.forEach((_, i) => {
      this.utxos.delete(`${oldTxid}:${i}`);
    });
    this.mempool.delete(oldTxid);
    this.dropped.add(oldTxid);

    const replacementTxid = randomHex(32);
    const total = old.outputs.reduce((a, o) => a + o.amountSat, 0n);
    const feeSat = old.feeSat + 500n; // higher fee
    const newOutputs = [{ address: newAddress, amountSat: total - 500n }];
    this.mempool.set(replacementTxid, {
      txid: replacementTxid,
      inputs: old.inputs,
      outputs: newOutputs,
      feeSat,
      replaceable: true,
    });
    newOutputs.forEach((o, i) => {
      this.utxos.set(`${replacementTxid}:${i}`, {
        txid: replacementTxid,
        vout: i,
        address: o.address,
        amountSat: o.amountSat,
        spent: false,
      });
    });
    return replacementTxid;
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
