// Bitcoin address validation. Used by the deposit display layer
// (Phase 3) and by withdrawal flows (Phase 7+).
//
// Accepts:
//   - Legacy P2PKH: mainnet starts with "1", regtest "m"/"n"
//   - P2SH: mainnet "3", regtest "2"
//   - Bech32 native segwit: HRP "bc" (mainnet), "tb" (testnet),
//     "bcrt" (regtest)
//   - Bech32m taproot: same HRPs
//
// Older mobile clients occasionally pasted addresses with zero-width
// separators picked up from QR scan-and-copy; we strip those before
// validating so the user doesn't see a confusing "invalid address"
// error for what looks like the right string.

const ZERO_WIDTH_RX = /[​‌‍﻿]/g;

const BECH32_HRPS = ["bc", "tb", "bcrt"];
const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function isLegacy(addr: string): boolean {
  // Base58 length range for P2PKH/P2SH is roughly 26-35.
  if (addr.length < 26 || addr.length > 35) return false;
  const head = addr[0];
  if (!head) return false;
  if (!["1", "3", "m", "n", "2"].includes(head)) return false;
  // Strict base58 alphabet (no 0, O, I, l).
  return /^[1-9A-HJ-NP-Za-km-z]+$/.test(addr);
}

function isBech32Like(addr: string): boolean {
  const sep = addr.lastIndexOf("1");
  if (sep < 1 || sep + 7 > addr.length) return false;
  const hrp = addr.slice(0, sep).toLowerCase();
  if (!BECH32_HRPS.includes(hrp)) return false;
  const data = addr.slice(sep + 1).toLowerCase();
  for (const ch of data) {
    if (!BECH32_CHARSET.includes(ch)) return false;
  }
  return true;
}

export function isValidBtcAddress(input: string): boolean {
  const a = input.trim().replace(ZERO_WIDTH_RX, "");
  if (a.length === 0) return false;
  return isLegacy(a) || isBech32Like(a);
}

export function normalizeBtcAddress(input: string): string {
  return input.trim().replace(ZERO_WIDTH_RX, "");
}
