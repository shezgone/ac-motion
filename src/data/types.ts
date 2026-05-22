export type VenueKind = "conference" | "journal";

export interface Venue {
  id: string;
  name: string;
  acronym?: string;
  kind: VenueKind;
  field: string;
  grade: string;
  country?: string;
  deadline?: string;
  url: string;
  source: string;
}

export type GraphNodeKind = "country" | "field" | "venue";

export interface Filters {
  search: string;
  kinds: Set<VenueKind>;
  grades: Set<string>;
  fields: Set<string>;
  countries: Set<string>;
  showRelations: boolean;
}

export function applyFilters(venues: Venue[], f: Filters): Venue[] {
  const term = f.search.trim().toLowerCase();
  return venues.filter((v) => {
    if (!f.kinds.has(v.kind)) return false;
    if (f.grades.size > 0 && !f.grades.has(v.grade)) return false;
    if (f.fields.size > 0 && !f.fields.has(v.field)) return false;
    if (f.countries.size > 0) {
      const c = v.country ?? "International";
      if (!f.countries.has(c)) return false;
    }
    if (term) {
      const hay = `${v.name} ${v.acronym ?? ""} ${v.field} ${v.country ?? ""}`.toLowerCase();
      if (!hay.includes(term)) return false;
    }
    return true;
  });
}

export interface GraphNode {
  id: string;
  label: string;
  kind: GraphNodeKind;
  venue?: Venue;
  val: number;
  color: string;
  x?: number;
  y?: number;
  z?: number;
}

export type GraphLinkKind = "tier" | "related";

export interface GraphLink {
  source: string;
  target: string;
  linkKind?: GraphLinkKind;
}

export interface VenueRelation {
  source: string;
  target: string;
  kind: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}
