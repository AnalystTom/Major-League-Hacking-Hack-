import { DigestOutput, type IngestedUnit } from "../types.js";

/** Validates shape, referenced ids and that cited timestamps lie within a contributing unit's window. */
export function validateDigest(raw: unknown, units: IngestedUnit[]): DigestOutput {
  const out = DigestOutput.parse(raw);
  const byId = new Map(units.map((u) => [u.id, u]));
  const need = (id: string, where: string) => {
    const u = byId.get(id);
    if (!u) throw new Error(`${where} references unknown or non-ready unit ${id}`);
    return u;
  };
  const used = new Set<string>();
  for (const a of out.artifacts) {
    for (const id of a.source_ids) { need(id, `artifact "${a.name}"`); used.add(id); }
    for (const ev of a.evidence) {
      const u = need(ev.source_id, `evidence in "${a.name}"`);
      if (!a.source_ids.includes(ev.source_id)) throw new Error(`evidence in "${a.name}" cites a unit not in its source_ids`);
      const [lo, hi] = u.transcript!.window;
      if (ev.start_seconds < lo || ev.end_seconds > hi) throw new Error(`evidence in "${a.name}" is outside unit ${ev.source_id}'s window`);
    }
  }
  for (const e of out.exclusions) {
    need(e.unit_id, "exclusion");
    if (used.has(e.unit_id)) throw new Error(`unit ${e.unit_id} is both used and excluded`);
  }
  return out;
}
