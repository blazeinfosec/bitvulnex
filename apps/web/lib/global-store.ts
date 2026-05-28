// Module-scoped state in Next.js App Router is fragile: HMR
// invalidates the module on edit, and route-segment bundles may
// produce duplicate module instances. For ephemeral cross-request
// state (login tickets, deposit-confirmation caches, etc.) anchor the
// store to `globalThis` so all importers share one instance.
//
// Mirrors the pattern used by `openapi-registry.ts` and `@bvbe/db`'s
// PrismaClient singleton.

type GlobalStores = Record<string, unknown>;

declare global {
  // eslint-disable-next-line no-var
  var __bvbeGlobalStores: GlobalStores | undefined;
}

export function getGlobalStore<T>(key: string, init: () => T): T {
  const root = (globalThis.__bvbeGlobalStores ??= {});
  if (!(key in root)) {
    (root as Record<string, unknown>)[key] = init();
  }
  return (root as Record<string, T>)[key] as T;
}
