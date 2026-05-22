import { writeFileSync, readdirSync, statSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CORE_CSV = resolve(ROOT, "data/raw/icore2026.csv");
const CCF_DIR = resolve(ROOT, "data/raw/ccf");
const JOURNALS_JSON = resolve(ROOT, "data/raw/journals_seed.json");
const RELATIONS_JSON = resolve(ROOT, "data/raw/venue_relations.json");
const OUT = resolve(ROOT, "src/data/venues.json");
const RELATIONS_OUT = resolve(ROOT, "src/data/relations.json");
const ACCEPTED_RANKS = new Set(["A*", "A", "B", "C"]);
// CORE underranks some well-known top venues (e.g., NSDI as "National: USA").
// Whitelist them by acronym so they participate in the graph + relations.
const WHITELIST_ACRONYMS = new Set(["NSDI"]);
const WHITELIST_OVERRIDE_GRADE = "A";

const FOR_TO_FIELD: Record<string, string> = {
  "4602": "AI/ML", "4611": "AI/ML", "0801": "AI/ML",
  "4603": "Vision/Graphics", "4607": "Vision/Graphics",
  "4604": "Security",
  "4605": "Data/DB", "0804": "Data/DB",
  "4606": "Systems", "0803": "Systems", "0805": "Systems",
  "4608": "HCI",
  "4609": "Info Systems", "4601": "Info Systems", "0806": "Info Systems",
  "4612": "Software Eng.",
  "4613": "Theory", "0802": "Theory",
};

const COUNTRY_NORMALIZE: Record<string, string> = {
  "us": "USA", "u.s.": "USA", "u.s.a.": "USA", "united states": "USA", "united states of america": "USA", "america": "USA", "usa": "USA",
  "uk": "United Kingdom", "u.k.": "United Kingdom", "england": "United Kingdom", "scotland": "United Kingdom", "wales": "United Kingdom", "britain": "United Kingdom", "great britain": "United Kingdom", "united kingdom": "United Kingdom",
  "uae": "UAE", "u.a.e.": "UAE", "united arab emirates": "UAE",
  "korea": "South Korea", "republic of korea": "South Korea", "south korea": "South Korea", "rep. of korea": "South Korea",
  "prc": "China", "china": "China", "p.r.china": "China", "p.r. china": "China",
  "deutschland": "Germany",
  "nederland": "Netherlands", "the netherlands": "Netherlands",
  "russia": "Russia", "russian federation": "Russia",
};

function normalizeCountry(raw: string): string | null {
  const cleaned = raw.toLowerCase().replace(/\.$/, "").trim();
  if (!cleaned) return null;
  return COUNTRY_NORMALIZE[cleaned] ?? raw.trim();
}

function parseCSVLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQ = false; }
      } else { cur += ch; }
    } else if (ch === ",") { out.push(cur); cur = ""; }
    else if (ch === '"') { inQ = true; }
    else { cur += ch; }
  }
  out.push(cur);
  return out;
}

interface CcfInstance {
  year: number;
  link?: string;
  date?: string;
  place?: string;
  timeline?: Array<{ deadline?: string; abstract_deadline?: string; comment?: string }>;
}
interface CcfEntry {
  title: string;
  description?: string;
  sub?: string;
  rank?: { ccf?: string; core?: string };
  dblp?: string;
  confs?: CcfInstance[];
}
interface DeadlineHit {
  deadline: string;
  link: string;
  country: string | null;
  year: number;
}

function loadCcfDeadlines(): Map<string, DeadlineHit> {
  const today = new Date().toISOString().slice(0, 10);
  const map = new Map<string, DeadlineHit>();

  function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (name.endsWith(".yml") || name.endsWith(".yaml")) {
        try {
          const data = yaml.load(readFileSync(p, "utf8")) as CcfEntry[] | null;
          if (!Array.isArray(data)) continue;
          for (const entry of data) {
            if (!entry.title || !entry.confs) continue;
            const upcoming = entry.confs
              .map((c) => {
                const tl = c.timeline?.[c.timeline.length - 1];
                const dl = tl?.deadline ?? tl?.abstract_deadline;
                return dl ? { ...c, _dl: dl } : null;
              })
              .filter((c): c is CcfInstance & { _dl: string } => !!c)
              .sort((a, b) => a._dl.localeCompare(b._dl));
            const next = upcoming.find((c) => c._dl >= today) ?? upcoming[upcoming.length - 1];
            if (!next) continue;
            const place = next.place ?? "";
            const country = place ? normalizeCountry(place.split(",").pop()!.trim()) : null;
            const key = entry.title.toUpperCase();
            map.set(key, {
              deadline: next._dl.slice(0, 10),
              link: next.link ?? "",
              country,
              year: next.year,
            });
          }
        } catch {}
      }
    }
  }
  walk(CCF_DIR);
  return map;
}

interface JournalSeed {
  acronym: string;
  name: string;
  field: string;
  grade: string;
  country: string;
  publisher: string;
  url: string;
}

interface OutVenue {
  id: string;
  name: string;
  acronym?: string;
  kind: "conference" | "journal";
  field: string;
  grade: string;
  country?: string;
  deadline?: string;
  url: string;
  source: string;
}

const ccfMap = loadCcfDeadlines();
console.log(`Loaded ${ccfMap.size} CCF deadlines`);

const venues: OutVenue[] = [];
const seen = new Set<string>();
const fieldCounts: Record<string, number> = {};
const gradeCounts: Record<string, number> = {};
const countryCounts: Record<string, number> = {};
let withDeadline = 0;
let withCountry = 0;

const coreText = readFileSync(CORE_CSV, "utf8");
for (const raw of coreText.split(/\r?\n/)) {
  if (!raw.trim()) continue;
  const cols = parseCSVLine(raw);
  if (cols.length < 7) continue;
  const id = cols[0]?.trim();
  const title = cols[1]?.trim();
  const acronym = cols[2]?.trim();
  const rank = cols[4]?.trim();
  const for1 = cols[6]?.trim();
  if (!acronym || !title) continue;
  const isWhitelisted = WHITELIST_ACRONYMS.has(acronym);
  if (!ACCEPTED_RANKS.has(rank) && !isWhitelisted) continue;
  const effectiveRank = isWhitelisted ? WHITELIST_OVERRIDE_GRADE : rank;
  const field = FOR_TO_FIELD[for1] ?? "Other CS";
  const venueId = `${acronym}-${id}`;
  if (seen.has(venueId)) continue;
  seen.add(venueId);

  const ccf = ccfMap.get(acronym.toUpperCase());
  const country = ccf?.country ?? "International";
  const url = ccf?.link || `https://portal.core.edu.au/conf-ranks/${id}/`;
  const sources = ["CORE ICORE2026"];
  if (ccf) sources.push("ccf-deadlines");

  if (ccf?.deadline) withDeadline++;
  if (ccf?.country) withCountry++;

  venues.push({
    id: venueId,
    name: title,
    acronym,
    kind: "conference",
    field,
    grade: effectiveRank,
    country,
    deadline: ccf?.deadline,
    url,
    source: sources.join(" + ") + (isWhitelisted ? " (whitelisted)" : ""),
  });
  fieldCounts[field] = (fieldCounts[field] ?? 0) + 1;
  gradeCounts[effectiveRank] = (gradeCounts[effectiveRank] ?? 0) + 1;
  countryCounts[country] = (countryCounts[country] ?? 0) + 1;
}

const journalSeeds = JSON.parse(readFileSync(JOURNALS_JSON, "utf8")) as JournalSeed[];
for (const j of journalSeeds) {
  const venueId = `JOURNAL:${j.acronym}`;
  if (seen.has(venueId)) continue;
  seen.add(venueId);
  venues.push({
    id: venueId,
    name: j.name,
    acronym: j.acronym,
    kind: "journal",
    field: j.field,
    grade: j.grade,
    country: j.country,
    url: j.url,
    source: `seed (${j.publisher})`,
  });
  fieldCounts[j.field] = (fieldCounts[j.field] ?? 0) + 1;
  gradeCounts[j.grade] = (gradeCounts[j.grade] ?? 0) + 1;
  countryCounts[j.country] = (countryCounts[j.country] ?? 0) + 1;
}

// Resolve curated relations: map acronyms to venue IDs.
interface RawRelation { from: string; to: string; kind?: string }
interface ResolvedRelation { source: string; target: string; kind: string }

const acronymIndex = new Map<string, string>();
for (const v of venues) {
  if (v.acronym) {
    const k = v.acronym.toUpperCase();
    if (!acronymIndex.has(k)) acronymIndex.set(k, v.id);
  }
}

const rawRelations = JSON.parse(readFileSync(RELATIONS_JSON, "utf8")) as RawRelation[];
const resolved: ResolvedRelation[] = [];
const unresolved: string[] = [];
for (const r of rawRelations) {
  const s = acronymIndex.get(r.from.toUpperCase());
  const t = acronymIndex.get(r.to.toUpperCase());
  if (s && t) {
    resolved.push({ source: s, target: t, kind: r.kind ?? "related" });
  } else {
    if (!s) unresolved.push(r.from);
    if (!t) unresolved.push(r.to);
  }
}

writeFileSync(OUT, JSON.stringify(venues, null, 2));
writeFileSync(RELATIONS_OUT, JSON.stringify(resolved, null, 2));

console.log(`\nWrote ${venues.length} venues → ${OUT}`);
console.log(`Wrote ${resolved.length} resolved relations / ${rawRelations.length} curated → ${RELATIONS_OUT}`);
if (unresolved.length > 0) {
  const unique = [...new Set(unresolved)];
  console.log(`  Unresolved acronyms (${unique.length}):`, unique.join(", "));
}
console.log(`  conferences: ${venues.filter((v) => v.kind === "conference").length}`);
console.log(`  journals:    ${venues.filter((v) => v.kind === "journal").length}`);
console.log(`  with deadline (from ccf): ${withDeadline}`);
console.log(`  with concrete country (non-International): ${withCountry + journalSeeds.length}`);
console.log(`\nGrades:`, gradeCounts);
console.log(`Fields:`, fieldCounts);
console.log(`Top 12 countries:`,
  Object.entries(countryCounts).sort((a, b) => b[1] - a[1]).slice(0, 12),
);
