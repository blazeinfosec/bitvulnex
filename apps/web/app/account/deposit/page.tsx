"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { authedFetch } from "@/lib/token-storage";

type DepositRow = {
  id: string;
  asset: string;
  txid: string;
  vout: number;
  amount: string;
  confirmations: number;
  status: string;
  seenAt: string;
  creditedAt: string | null;
};

type BalanceRow = { asset: string; amount: string; updatedAt: string };

export default function DepositPage() {
  const router = useRouter();
  const [address, setAddress] = useState<string | null>(null);
  const [deposits, setDeposits] = useState<DepositRow[]>([]);
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [labEnabled, setLabEnabled] = useState(false);
  const [labAmount, setLabAmount] = useState("0.5");
  const [labRbfTxid, setLabRbfTxid] = useState("");
  const [labRbfAddr, setLabRbfAddr] = useState("bcrt1qattackercontrolled000000000000000000");
  const [message, setMessage] = useState<string | null>(null);

  async function loadAll() {
    const [addrRes, depRes, balRes] = await Promise.all([
      authedFetch("/api/v2/me/deposit/address"),
      authedFetch("/api/v2/me/deposits"),
      authedFetch("/api/v2/me/balance"),
    ]);
    if (addrRes.status === 401) {
      router.replace("/login");
      return;
    }
    if (!addrRes.ok) {
      const body = (await addrRes.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      setError(body.error?.message ?? "could not load address");
    } else {
      const a = (await addrRes.json()) as { address: string };
      setAddress(a.address);
    }
    if (depRes.ok) {
      const b = (await depRes.json()) as { deposits: DepositRow[] };
      setDeposits(b.deposits);
    }
    if (balRes.ok) {
      const b = (await balRes.json()) as { balances: BalanceRow[] };
      setBalances(b.balances);
    }
    // Try a lab affordance to see if it's enabled.
    const probe = await authedFetch("/api/v2/dev/btc/mine", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ blocks: 0 }),
    });
    setLabEnabled(probe.status !== 404);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function labSend() {
    if (!address) return;
    const res = await authedFetch("/api/v2/dev/btc/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address, amountBtc: Number(labAmount) }),
    });
    const body = (await res.json()) as { txid?: string; error?: { message: string } };
    setMessage(body.txid ? `sent ${labAmount} BTC, txid ${body.txid.slice(0, 16)}…` : "send failed");
    if (body.txid) setLabRbfTxid(body.txid);
    setTimeout(loadAll, 5500);
  }

  async function labMine(blocks: number) {
    const res = await authedFetch("/api/v2/dev/btc/mine", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ blocks }),
    });
    if (res.ok) setMessage(`mined ${blocks} block${blocks > 1 ? "s" : ""}`);
    setTimeout(loadAll, 5500);
  }

  async function labRbf() {
    const res = await authedFetch("/api/v2/dev/btc/rbf", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ txid: labRbfTxid, newAddress: labRbfAddr }),
    });
    const body = (await res.json()) as {
      replacementTxid?: string;
      error?: { message: string };
    };
    setMessage(
      body.replacementTxid
        ? `RBF replaced; new txid ${body.replacementTxid.slice(0, 16)}…`
        : `RBF failed: ${body.error?.message ?? "?"}`,
    );
    setTimeout(loadAll, 5500);
  }

  return (
    <Container className="py-12 max-w-3xl space-y-4">
      <h1 className="text-3xl font-semibold tracking-tight text-navy-900 mb-2">
        Deposit
      </h1>

      <Card>
        <CardHeader>
          <CardTitle>Your BTC deposit address</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          {error && <p className="text-danger">{error}</p>}
          {address && (
            <>
              <p className="text-navy-700">
                Send BTC to this address. Funds will appear in your balance
                after confirmation.
              </p>
              <pre className="bg-navy-50 border border-navy-200 rounded p-2 font-mono break-all">
                {address}
              </pre>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => navigator.clipboard.writeText(address)}
              >
                Copy
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Balances</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {balances.length === 0 ? (
            <p className="text-navy-700">No balances yet.</p>
          ) : (
            <table className="w-full">
              <thead className="text-left text-navy-500 text-xs uppercase">
                <tr>
                  <th className="py-1">Asset</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {balances.map((b) => (
                  <tr key={b.asset} className="border-t border-navy-200">
                    <td className="py-2">{b.asset}</td>
                    <td className="font-tabular">{b.amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent deposits</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {deposits.length === 0 ? (
            <p className="text-navy-700">No deposits yet.</p>
          ) : (
            <table className="w-full">
              <thead className="text-left text-navy-500 text-xs uppercase">
                <tr>
                  <th className="py-1">Txid</th>
                  <th>Amount</th>
                  <th>Confs</th>
                  <th>Status</th>
                  <th>Seen</th>
                </tr>
              </thead>
              <tbody>
                {deposits.map((d) => (
                  <tr key={d.id} className="border-t border-navy-200">
                    <td className="py-2 font-mono">
                      {d.txid.slice(0, 12)}…:{d.vout}
                    </td>
                    <td className="font-tabular">{d.amount}</td>
                    <td className="font-tabular">{d.confirmations}</td>
                    <td>{d.status}</td>
                    <td className="font-tabular">
                      {new Date(d.seenAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {labEnabled && (
        <Card>
          <CardHeader>
            <CardTitle>
              Lab test toolkit{" "}
              <span className="ml-2 text-xs uppercase tracking-wider px-2 py-0.5 rounded bg-danger text-danger-fg">
                Dev / Lab only
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-3">
            <div className="flex items-center gap-2">
              <label>Amount BTC</label>
              <input
                value={labAmount}
                onChange={(e) => setLabAmount(e.target.value)}
                className="border border-navy-200 rounded-md h-10 px-3 font-mono w-32"
              />
              <Button onClick={labSend} variant="secondary">
                Send to deposit address
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={() => labMine(1)} variant="secondary">
                Mine 1 block
              </Button>
              <Button onClick={() => labMine(3)} variant="secondary">
                Mine 3 blocks
              </Button>
            </div>
            <div className="space-y-2">
              <p className="text-navy-700">
                RBF-replace a mempool TX (point the original amount at a
                different address):
              </p>
              <div className="flex items-center gap-2">
                <input
                  value={labRbfTxid}
                  onChange={(e) => setLabRbfTxid(e.target.value)}
                  placeholder="txid"
                  className="flex-1 border border-navy-200 rounded-md h-10 px-3 font-mono text-xs"
                />
                <input
                  value={labRbfAddr}
                  onChange={(e) => setLabRbfAddr(e.target.value)}
                  placeholder="new address"
                  className="flex-1 border border-navy-200 rounded-md h-10 px-3 font-mono text-xs"
                />
                <Button onClick={labRbf} variant="secondary">
                  RBF
                </Button>
              </div>
            </div>
            {message && <p className="text-navy-700">{message}</p>}
          </CardContent>
        </Card>
      )}
    </Container>
  );
}
