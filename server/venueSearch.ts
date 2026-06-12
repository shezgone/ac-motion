import type { Venue } from "../src/data/types";

export interface VenueQuery {
  query?: string;
  field?: string;
  country?: string;
  grade?: string;
  kind?: "conference" | "journal";
  limit?: number;
}

export interface VenueHit {
  acronym: string | null;
  name: string;
  kind: Venue["kind"];
  field: string;
  grade: string;
  country: string;
  deadline: string | null;
  url: string;
}

const MAX_LIMIT = 30;

export function searchVenues(venues: Venue[], q: VenueQuery): VenueHit[] {
  const term = q.query?.trim().toLowerCase();
  const limit = Math.min(Math.max(q.limit ?? 12, 1), MAX_LIMIT);

  return venues
    .filter((v) => {
      if (q.kind && v.kind !== q.kind) return false;
      if (q.field && v.field.toLowerCase() !== q.field.toLowerCase()) return false;
      if (q.grade && v.grade.toLowerCase() !== q.grade.toLowerCase()) return false;
      if (q.country && (v.country ?? "International").toLowerCase() !== q.country.toLowerCase())
        return false;
      if (term) {
        const hay = `${v.name} ${v.acronym ?? ""} ${v.field}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    })
    .slice(0, limit)
    .map((v) => ({
      acronym: v.acronym ?? null,
      name: v.name,
      kind: v.kind,
      field: v.field,
      grade: v.grade,
      country: v.country ?? "International",
      deadline: v.deadline ?? null,
      url: v.url,
    }));
}

export function listFacets(venues: Venue[]): { fields: string[]; grades: string[]; countries: string[] } {
  return {
    fields: [...new Set(venues.map((v) => v.field))].sort(),
    grades: [...new Set(venues.map((v) => v.grade))].sort(),
    countries: [...new Set(venues.map((v) => v.country ?? "International"))].sort(),
  };
}
