// OFAC sanctions list importer. Beta feature; parses an XML blob into
// a normalized entry list. Compliance officers can use this to bulk-
// match users against a sanctions feed during periodic reviews.

import { parseString } from "xml2js";

export type SanctionsEntry = {
  name: string;
  source?: string;
  notes?: string;
};

export async function importSanctionsXml(
  xml: string,
): Promise<{ entries: SanctionsEntry[] }> {
  const parsed = await new Promise<any>((resolve, reject) => {
    parseString(xml, { trim: true }, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
  const root = parsed?.sanctions ?? parsed?.SanctionsList ?? {};
  const items = Array.isArray(root.entry)
    ? root.entry
    : root.entry
      ? [root.entry]
      : [];
  const entries: SanctionsEntry[] = items.map((item: any) => ({
    name: String(item.name?.[0] ?? item.name ?? ""),
    source: item.source?.[0] ?? item.source,
    notes: item.notes?.[0] ?? item.notes,
  }));
  return { entries };
}
