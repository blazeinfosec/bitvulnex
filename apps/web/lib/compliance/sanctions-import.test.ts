import { describe, it, expect } from "vitest";
import { importSanctionsXml } from "./sanctions-import";

describe("importSanctionsXml", () => {
  it("parses a benign sanctions list with multiple entries", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sanctions>
  <entry>
    <name>Synthetic Subject Alpha</name>
    <source>OFAC SDN</source>
    <notes>Lab data only.</notes>
  </entry>
  <entry>
    <name>Synthetic Subject Bravo</name>
    <source>OFAC SDN</source>
  </entry>
  <entry>
    <name>Synthetic Subject Charlie</name>
  </entry>
</sanctions>`;
    const { entries } = await importSanctionsXml(xml);
    expect(entries).toHaveLength(3);
    expect(entries[0]?.name).toBe("Synthetic Subject Alpha");
    expect(entries[0]?.source).toBe("OFAC SDN");
    expect(entries[1]?.name).toBe("Synthetic Subject Bravo");
    expect(entries[2]?.name).toBe("Synthetic Subject Charlie");
  });

  it("returns an empty list when no entries are present", async () => {
    const xml = `<?xml version="1.0"?><sanctions></sanctions>`;
    const { entries } = await importSanctionsXml(xml);
    expect(entries).toEqual([]);
  });
});
