import { Suspense } from "react";
import { Container } from "@/components/ui/container";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <Container className="py-16 max-w-md">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </Container>
  );
}
