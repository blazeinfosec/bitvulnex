"use server";

import { prisma } from "@bvbe/db";

// "Advanced order edit" affordance for VIP traders who need to tweak
// resting orders without cancel/replace. The page form normally only
// renders `price` and `amount` inputs; this action is called when
// the form submits.

export async function editOrder(formData: FormData): Promise<{ ok: boolean }> {
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return { ok: false };

  // Forward every field to the update. Faster than enumerating each
  // field we accept; the page only sends `price` and `amount`.
  const data: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) {
    if (k === "id") continue;
    data[k] = v;
  }

  await prisma.order.update({ where: { id }, data });
  return { ok: true };
}
