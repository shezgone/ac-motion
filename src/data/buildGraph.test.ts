import { describe, expect, it } from "bun:test";
import { buildGraph, gradeColor } from "./buildGraph";
import { applyFilters, type Filters, type Venue, type VenueRelation } from "./types";

function venue(over: Partial<Venue> & Pick<Venue, "id">): Venue {
  return {
    name: over.id.toUpperCase(),
    kind: "conference",
    field: "AI/ML",
    grade: "A*",
    url: "https://example.org",
    source: "test",
    ...over,
  };
}

const icml = venue({ id: "icml", acronym: "ICML", country: "South Korea" });
const cvpr = venue({ id: "cvpr", acronym: "CVPR", field: "Vision/Graphics" });
const jcs = venue({ id: "jcs", kind: "journal", grade: "KCI", country: "South Korea" });

describe("buildGraph", () => {
  it("builds country → field → venue hierarchy with tier links", () => {
    const g = buildGraph([icml]);
    expect(g.nodes.map((n) => n.id)).toEqual([
      "country:South Korea",
      "cf:South Korea:AI/ML",
      "venue:icml",
    ]);
    expect(g.links).toEqual([
      { source: "country:South Korea", target: "cf:South Korea:AI/ML", linkKind: "tier" },
      { source: "cf:South Korea:AI/ML", target: "venue:icml", linkKind: "tier" },
    ]);
  });

  it("falls back to International when country is missing", () => {
    const g = buildGraph([cvpr]);
    expect(g.nodes.some((n) => n.id === "country:International")).toBe(true);
  });

  it("deduplicates shared country and field nodes", () => {
    const g = buildGraph([icml, jcs]);
    const countries = g.nodes.filter((n) => n.kind === "country");
    expect(countries).toHaveLength(1);
    expect(g.nodes.filter((n) => n.kind === "venue")).toHaveLength(2);
  });

  it("adds related links only when both endpoints are present", () => {
    const rels: VenueRelation[] = [
      { source: "icml", target: "cvpr", kind: "field" },
      { source: "icml", target: "missing", kind: "field" },
    ];
    const g = buildGraph([icml, cvpr], rels);
    const related = g.links.filter((l) => l.linkKind === "related");
    expect(related).toEqual([{ source: "venue:icml", target: "venue:cvpr", linkKind: "related" }]);
  });

  it("drops related links when includeRelations is false", () => {
    const rels: VenueRelation[] = [{ source: "icml", target: "cvpr", kind: "field" }];
    const g = buildGraph([icml, cvpr], rels, false);
    expect(g.links.every((l) => l.linkKind === "tier")).toBe(true);
  });

  it("falls back to gray for unknown grades", () => {
    expect(gradeColor("Z9")).toBe("#808080");
  });

  it("bonds same-field nodes across countries when bondSameFields is on", () => {
    const intlAi1 = venue({ id: "a1" });
    const intlAi2 = venue({ id: "a2" });
    const krAi = venue({ id: "k1", country: "South Korea" });
    const g = buildGraph([intlAi1, intlAi2, krAi, cvpr], [], true, true);
    const bonds = g.links.filter((l) => l.linkKind === "fieldBond");
    // AI/ML만 두 나라에 존재 — 허브(베뉴 2개인 International)에서 한국으로 1개
    expect(bonds).toEqual([
      { source: "cf:International:AI/ML", target: "cf:South Korea:AI/ML", linkKind: "fieldBond" },
    ]);
  });

  it("adds no bonds by default or when a field exists in one country only", () => {
    const g1 = buildGraph([icml, jcs], [], true);
    expect(g1.links.some((l) => l.linkKind === "fieldBond")).toBe(false);
    const g2 = buildGraph([icml, jcs], [], true, true); // 둘 다 South Korea AI/ML
    expect(g2.links.some((l) => l.linkKind === "fieldBond")).toBe(false);
  });
});

function filters(over: Partial<Filters> = {}): Filters {
  return {
    search: "",
    kinds: new Set(["conference", "journal"]),
    grades: new Set(),
    fields: new Set(),
    countries: new Set(),
    showRelations: true,
    ...over,
  };
}

describe("applyFilters", () => {
  const all = [icml, cvpr, jcs];

  it("keeps everything with empty filter sets", () => {
    expect(applyFilters(all, filters())).toHaveLength(3);
  });

  it("filters by kind", () => {
    const out = applyFilters(all, filters({ kinds: new Set(["journal"]) }));
    expect(out.map((v) => v.id)).toEqual(["jcs"]);
  });

  it("filters by grade only when grades are selected", () => {
    const out = applyFilters(all, filters({ grades: new Set(["A*"]) }));
    expect(out.map((v) => v.id)).toEqual(["icml", "cvpr"]);
  });

  it("treats missing country as International", () => {
    const out = applyFilters(all, filters({ countries: new Set(["International"]) }));
    expect(out.map((v) => v.id)).toEqual(["cvpr"]);
  });

  it("matches search against acronym case-insensitively", () => {
    const out = applyFilters(all, filters({ search: "cVpR" }));
    expect(out.map((v) => v.id)).toEqual(["cvpr"]);
  });
});
