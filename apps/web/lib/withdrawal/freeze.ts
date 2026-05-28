// Frozen-user check. There's no User.frozen column — instead the
// latest user_freeze / user_unfreeze row in the AdminAuditLog stream
// is the source of truth. Withdrawal submit consults this before
// going through the balance check.

import { prisma as defaultPrisma } from "@bvbe/db";

export async function isUserFrozen(
  userId: string,
  db: typeof defaultPrisma = defaultPrisma,
): Promise<boolean> {
  const last = await db.adminAuditLog.findFirst({
    where: {
      targetType: "user",
      targetId: userId,
      action: { in: ["user_freeze", "user_unfreeze"] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!last) return false;
  return last.action === "user_freeze";
}
