import { describe, expect, it } from "bun:test";
import { listFacets, searchVenues } from "./venueSearch";
import type { Venue } from "../src/data/types";

const venues: Venue[] = [
  { id: "icml", name: "International Conference on Machine Learning", acronym: "ICML", kind: "conference", field: "AI/ML", grade: "A*", country: "South Korea", url: "https://icml.cc", source: "test" },
  { id: "cvpr", name: "Computer Vision and Pattern Recognition", acronym: "CVPR", kind: "conference", field: "Vision/Graphics", grade: "A*", url: "https://cvpr.org", source: "test" },
  { id: "tmlr", name: "Transactions on Machine Learning Research", kind: "journal", field: "AI/ML", grade: "Q1", url: "https://tmlr.org", source: "test" },
];

describe("searchVenues", () => {
  it("matches query against name and acronym, case-insensitively", () => {
    expect(searchVenues(venues, { query: "cVpR" }).map((v) => v.acronym)).toEqual(["CVPR"]);
    expect(searchVenues(venues, { query: "machine learning" })).toHaveLength(2);
  });

  it("filters by field, kind, and grade exactly", () => {
    expect(searchVenues(venues, { field: "ai/ml", kind: "journal" }).map((v) => v.name)).toEqual([
      "Transactions on Machine Learning Research",
    ]);
    expect(searchVenues(venues, { grade: "A*" })).toHaveLength(2);
  });

  it("treats missing country as International", () => {
    expect(searchVenues(venues, { country: "International" }).map((v) => v.acronym)).toEqual([
      "CVPR",
      null,
    ]);
  });

  it("clamps limit to a sane range", () => {
    expect(searchVenues(venues, { limit: 1 })).toHaveLength(1);
    expect(searchVenues(venues, { limit: 9999 })).toHaveLength(3);
  });
});

describe("listFacets", () => {
  it("collects sorted unique facet values", () => {
    const f = listFacets(venues);
    expect(f.fields).toEqual(["AI/ML", "Vision/Graphics"]);
    expect(f.grades).toEqual(["A*", "Q1"]);
    expect(f.countries).toContain("International");
  });
});
