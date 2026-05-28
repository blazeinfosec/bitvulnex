import { Suspense } from "react";
import { Container } from "@/components/ui/container";
import { ResetForm } from "./reset-form";

export default function ResetPage() {
  return (
    <Container className="py-16 max-w-md">
      <Suspense fallback={null}>
        <ResetForm />
      </Suspense>
    </Container>
  );
}
