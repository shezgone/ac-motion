import type { GraphData, GraphLink, GraphNode, Venue, VenueRelation } from "./types";

export const COUNTRY_COLOR = "#5b8def";
export const FIELD_COLOR = "#9b6bff";

export const GRADE_COLOR: Record<string, string> = {
  "A*": "#ffd770",
  A: "#f0a050",
  B: "#7da3d8",
  C: "#5a6670",
  Q1: "#4ad6a6",
  Q2: "#3ba282",
  "KCI Top": "#e76f87",
  KCI: "#a85669",
};
const GRADE_VAL: Record<string, number> = {
  "A*": 7,
  A: 6,
  B: 4,
  C: 3,
  Q1: 6,
  Q2: 4,
  "KCI Top": 5,
  KCI: 3,
};

export function gradeColor(g: string): string {
  return GRADE_COLOR[g] ?? "#808080";
}
function gradeVal(g: string): number {
  return GRADE_VAL[g] ?? 3;
}

export function buildGraph(
  venues: Venue[],
  relations: VenueRelation[] = [],
  includeRelations = true,
): GraphData {
  const nodes = new Map<string, GraphNode>();
  const links: GraphLink[] = [];
  const venueIds = new Set<string>();

  for (const v of venues) {
    const country = v.country ?? "International";
    const countryId = `country:${country}`;
    const cfId = `cf:${country}:${v.field}`;
    const venueId = `venue:${v.id}`;
    venueIds.add(v.id);

    if (!nodes.has(countryId)) {
      nodes.set(countryId, {
        id: countryId,
        label: country,
        kind: "country",
        val: 18,
        color: COUNTRY_COLOR,
      });
    }
    if (!nodes.has(cfId)) {
      nodes.set(cfId, {
        id: cfId,
        label: v.field,
        kind: "field",
        val: 7,
        color: FIELD_COLOR,
      });
      links.push({ source: countryId, target: cfId, linkKind: "tier" });
    }
    nodes.set(venueId, {
      id: venueId,
      label: v.acronym ?? v.name,
      kind: "venue",
      venue: v,
      val: gradeVal(v.grade),
      color: gradeColor(v.grade),
    });
    links.push({ source: cfId, target: venueId, linkKind: "tier" });
  }

  if (includeRelations) {
    for (const r of relations) {
      if (!venueIds.has(r.source) || !venueIds.has(r.target)) continue;
      links.push({
        source: `venue:${r.source}`,
        target: `venue:${r.target}`,
        linkKind: "related",
      });
    }
  }

  return { nodes: [...nodes.values()], links };
}
