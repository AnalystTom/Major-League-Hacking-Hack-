import { DigestOutput, type IngestedUnit } from "../types.js";
import { unitRef } from "./prompt.js";

/** Replaces the model's unit refs ("u3") with real unit ids. Real ids are accepted as-is; unknown refs are left for validation to reject. */
function resolveRefs(raw: unknown, units: IngestedUnit[]): unknown {
  const map = new Map<string, string>(units.map((u, i) => [unitRef(i), u.id]));
  const fix = (v: unknown) => (typeof v === "string" ? map.get(v) ?? v : v);
  if (!raw || typeof raw !== "object") return raw;
  const r = raw as { artifacts?: unknown; exclusions?: unknown };
  const each = (list: unknown, f: (x: Record<string, unknown>) => Record<string, unknown>) =>
    Array.isArray(list) ? list.map((x) => (x && typeof x === "object" ? f(x as Record<string, unknown>) : x)) : list;
  return {
    ...r,
    artifacts: each(r.artifacts, (a) => ({
      ...a,
      source_ids: Array.isArray(a.source_ids) ? a.source_ids.map(fix) : a.source_ids,
      evidence: each(a.evidence, (e) => ({ ...e, source_id: fix(e.source_id) })),
    })),
    exclusions: each(r.exclusions, (e) => ({ ...e, unit_id: fix(e.unit_id) })),
  };
}

/** Validates shape, referenced ids and that cited timestamps lie within a contributing unit's window. */
export function validateDigest(raw: unknown, units: IngestedUnit[]): DigestOutput {
  const out = DigestOutput.parse(resolveRefs(raw, units));
  const byId = new Map(units.map((u) => [u.id, u]));
  const need = (id: string, where: string) => {
    const u = byId.get(id);
    if (!u) throw new Error(`${where} cites "${id}", which is not one of the supplied units (valid refs: ${units.map((_, i) => unitRef(i)).join(", ")})`);
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
