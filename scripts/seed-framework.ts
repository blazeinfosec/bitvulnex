// Seed framework. Phase 0 implements only `fakeUser`; Phase 1+ adds
// `fakeOrder`, `fakeTicket`, `fakeKycDoc`, etc.
//
// Hard rule: all generated data must be obviously synthetic. No real
// PII patterns. No real Bitcoin addresses. No real email domains
// outside of bvbe.local / example.test.

import { randomBytes } from "node:crypto";

export type FakeUser = {
  email: string;
  displayName: string;
  passwordHash: string;
};

const SAMPLE_FIRST = [
  "Ada", "Linus", "Grace", "Donald", "Margaret", "Edsger", "Barbara",
  "Tim", "Brian", "Ken", "Brendan", "Anita", "Radia", "Vint",
];
const SAMPLE_LAST = [
  "Lovelace", "Torvalds", "Hopper", "Knuth", "Hamilton", "Dijkstra",
  "Liskov", "Berners-Lee", "Kernighan", "Thompson", "Eich", "Borg",
  "Perlman", "Cerf",
];

function pick<T>(arr: readonly T[]): T {
  const i = randomBytes(2).readUInt16BE(0) % arr.length;
  const v = arr[i];
  if (v === undefined) throw new Error("empty pool");
  return v;
}

export function fakeUser(i: number): FakeUser {
  const first = pick(SAMPLE_FIRST);
  const last = pick(SAMPLE_LAST);
  const tag = randomBytes(3).toString("hex");
  return {
    email: `${first.toLowerCase()}.${last.toLowerCase()}.${tag}@example.test`,
    displayName: `${first} ${last} #${i}`,
    // Phase 0 ships only the shape; Phase 1's seed will hash a real
    // (synthetic) password through the same scrypt routine as the
    // signup flow.
    passwordHash: `pending-phase-1`,
  };
}
