import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginStubPage() {
  return (
    <Container className="py-16 max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-navy-700">
          <p>
            Authentication ships in Phase 1. This is a Phase 0 placeholder so
            the navigation links resolve.
          </p>
          <Button asChild variant="secondary">
            <Link href="/">Return to landing</Link>
          </Button>
        </CardContent>
      </Card>
    </Container>
  );
}
