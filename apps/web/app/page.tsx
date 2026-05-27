import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const PLACEHOLDER_TICKER = [
  { pair: "BTC/USDT", price: "—", change: "—" },
  { pair: "ETH/USDT", price: "—", change: "—" },
  { pair: "LTC/USDT", price: "—", change: "—" },
  { pair: "DOGE/USDT", price: "—", change: "—" },
];

export default function HomePage() {
  return (
    <>
      <section className="bg-gradient-to-b from-navy-50 to-white border-b border-navy-200">
        <Container className="py-20">
          <div className="max-w-3xl">
            <p className="text-xs uppercase tracking-widest text-navy-500 mb-3">
              Institutional spot · margin · OTC
            </p>
            <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight text-navy-900 mb-4">
              Trade Bitcoin and majors with desk-grade execution.
            </h1>
            <p className="text-lg text-navy-700 mb-8 max-w-2xl">
              BVBE is a deliberately vulnerable training exchange. Build attack
              chains, exercise blue-team detection, or just inspect the code.
              Nothing here touches mainnet.
            </p>
            <div className="flex gap-3">
              <Button size="lg" asChild>
                <Link href="/signup">Create lab account</Link>
              </Button>
              <Button size="lg" variant="secondary" asChild>
                <Link href="/docs">Read the API docs</Link>
              </Button>
            </div>
          </div>
        </Container>
      </section>

      <section className="py-12">
        <Container>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {PLACEHOLDER_TICKER.map((t) => (
              <Card key={t.pair}>
                <CardContent className="pt-6">
                  <div className="text-xs uppercase tracking-wide text-navy-500">
                    {t.pair}
                  </div>
                  <div className="text-2xl font-semibold font-tabular text-navy-900 mt-1">
                    {t.price}
                  </div>
                  <div className="text-sm text-navy-500 font-tabular">
                    {t.change}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </Container>
      </section>

      <section className="py-12 border-t border-navy-200 bg-navy-50/40">
        <Container>
          <div className="grid md:grid-cols-3 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>For pentesters</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-navy-700">
                ~39 planted vulnerabilities across OWASP, PortSwigger, James
                Kettle, and Bitcoin-specific categories. Pyramid difficulty.
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>For instructors</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-navy-700">
                Toggle CTF mode for flags and scoreboard, or run black-box.
                Single-tenant per trainee via Docker Compose.
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>For blue teams</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-navy-700">
                Four documented killer chains map to realistic exchange
                breaches: drain hot wallet, become admin, mass takeover, exfil
                PII.
              </CardContent>
            </Card>
          </div>
        </Container>
      </section>
    </>
  );
}
