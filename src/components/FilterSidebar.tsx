import { useMemo, useState } from "react";
import type { Filters, Venue, VenueKind } from "../data/types";
import { COUNTRY_COLOR, FIELD_COLOR, gradeColor } from "../data/buildGraph";
import {
  glassButton,
  glassIconButton,
  glassInput,
  glassLink,
  glassPanel,
} from "../styles/glass";

const PINNED_COUNTRIES = ["International", "South Korea"];

interface Props {
  allVenues: Venue[];
  shownCount: number;
  filters: Filters;
  onChange: (next: Filters) => void;
}

const PANEL_WIDTH = 280;

export function FilterSidebar({ allVenues, shownCount, filters, onChange }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  const facets = useMemo(() => buildFacets(allVenues), [allVenues]);

  const toggleSet = <T,>(set: Set<T>, val: T): Set<T> => {
    const next = new Set(set);
    if (next.has(val)) next.delete(val);
    else next.add(val);
    return next;
  };

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="glass-button"
        style={{ ...glassButton, position: "absolute", top: 60, left: 20 }}
        title="Show filters"
      >
        ☰ filters · {shownCount}
      </button>
    );
  }

  return (
    <aside
      style={{
        ...glassPanel,
        position: "absolute",
        top: 60,
        left: 20,
        bottom: 20,
        width: PANEL_WIDTH,
        padding: 18,
        fontSize: 12,
        overflowY: "auto",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <strong style={{ fontSize: 13, letterSpacing: 0.4 }}>filters</strong>
        <button
          onClick={() => setCollapsed(true)}
          className="glass-icon-button"
          style={glassIconButton}
          title="Collapse"
        >
          ←
        </button>
      </div>

      <input
        type="search"
        placeholder="search name / acronym / field…"
        value={filters.search}
        onChange={(e) => onChange({ ...filters, search: e.target.value })}
        className="glass-input"
        style={glassInput}
      />

      <Section title="kind">
        {(["conference", "journal"] as VenueKind[]).map((k) => (
          <Check
            key={k}
            label={`${k} (${facets.kinds[k] ?? 0})`}
            checked={filters.kinds.has(k)}
            onChange={() => onChange({ ...filters, kinds: toggleSet(filters.kinds, k) })}
          />
        ))}
      </Section>

      <Section title="edges">
        <Check
          label="show citation / related links"
          swatch="#ffe1b4"
          checked={filters.showRelations}
          onChange={() => onChange({ ...filters, showRelations: !filters.showRelations })}
        />
      </Section>

      <Section title="grade">
        {facets.grades.map((g) => (
          <Check
            key={g.value}
            label={`${g.value} (${g.count})`}
            swatch={gradeColor(g.value)}
            checked={filters.grades.size === 0 || filters.grades.has(g.value)}
            onChange={() => onChange({ ...filters, grades: toggleSet(filters.grades, g.value) })}
            dim={filters.grades.size > 0 && !filters.grades.has(g.value)}
          />
        ))}
        {filters.grades.size > 0 && (
          <button
            onClick={() => onChange({ ...filters, grades: new Set() })}
            className="glass-link"
            style={glassLink}
          >
            clear ({filters.grades.size})
          </button>
        )}
      </Section>

      <Section title="field">
        {facets.fields.map((f) => (
          <Check
            key={f.value}
            label={`${f.value} (${f.count})`}
            swatch={FIELD_COLOR}
            checked={filters.fields.size === 0 || filters.fields.has(f.value)}
            onChange={() => onChange({ ...filters, fields: toggleSet(filters.fields, f.value) })}
            dim={filters.fields.size > 0 && !filters.fields.has(f.value)}
          />
        ))}
        {filters.fields.size > 0 && (
          <button
            onClick={() => onChange({ ...filters, fields: new Set() })}
            className="glass-link"
            style={glassLink}
          >
            clear ({filters.fields.size})
          </button>
        )}
      </Section>

      <Section title={`country (top ${facets.countries.length})`}>
        {facets.countries.map((c) => (
          <Check
            key={c.value}
            label={`${c.value} (${c.count})`}
            swatch={COUNTRY_COLOR}
            checked={filters.countries.size === 0 || filters.countries.has(c.value)}
            onChange={() =>
              onChange({ ...filters, countries: toggleSet(filters.countries, c.value) })
            }
            dim={filters.countries.size > 0 && !filters.countries.has(c.value)}
          />
        ))}
        {filters.countries.size > 0 && (
          <button
            onClick={() => onChange({ ...filters, countries: new Set() })}
            className="glass-link"
            style={glassLink}
          >
            clear ({filters.countries.size})
          </button>
        )}
      </Section>

      <div
        style={{
          marginTop: 16,
          paddingTop: 12,
          borderTop: "1px solid rgba(255,255,255,0.08)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ opacity: 0.7 }}>
          showing <strong>{shownCount}</strong> / {allVenues.length}
        </span>
        <button
          onClick={() =>
            onChange({
              search: "",
              kinds: new Set(["conference", "journal"]),
              grades: new Set(),
              fields: new Set(),
              countries: new Set(),
              showRelations: filters.showRelations,
            })
          }
          className="glass-button"
          style={glassButton}
        >
          reset
        </button>
      </div>
    </aside>
  );
}

interface Facets {
  kinds: Partial<Record<VenueKind, number>>;
  grades: Array<{ value: string; count: number }>;
  fields: Array<{ value: string; count: number }>;
  countries: Array<{ value: string; count: number }>;
}

function buildFacets(venues: Venue[]): Facets {
  const kinds: Partial<Record<VenueKind, number>> = {};
  const grade: Record<string, number> = {};
  const field: Record<string, number> = {};
  const country: Record<string, number> = {};
  for (const v of venues) {
    kinds[v.kind] = (kinds[v.kind] ?? 0) + 1;
    grade[v.grade] = (grade[v.grade] ?? 0) + 1;
    field[v.field] = (field[v.field] ?? 0) + 1;
    const c = v.country ?? "International";
    country[c] = (country[c] ?? 0) + 1;
  }
  const sortByCount = (rec: Record<string, number>) =>
    Object.entries(rec)
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count);

  const countriesByCount = sortByCount(country);
  const pinned: Array<{ value: string; count: number }> = [];
  for (const name of PINNED_COUNTRIES) {
    const idx = countriesByCount.findIndex((c) => c.value === name);
    if (idx >= 0) pinned.push(countriesByCount.splice(idx, 1)[0]);
  }
  const countries = [...pinned, ...countriesByCount].slice(0, 15);

  return {
    kinds,
    grades: sortByCount(grade),
    fields: sortByCount(field),
    countries,
  };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div
        style={{
          textTransform: "uppercase",
          letterSpacing: 1,
          fontSize: 10,
          opacity: 0.55,
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
  dim,
  swatch,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
  dim?: boolean;
  swatch?: string;
}) {
  return (
    <label
      className="glass-row"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "4px 8px",
        margin: "0 -8px",
        borderRadius: 8,
        cursor: "pointer",
        opacity: dim ? 0.45 : 1,
        userSelect: "none",
        transition: "background 100ms ease",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="glass-checkbox"
      />
      {swatch && (
        <span
          style={{
            display: "inline-block",
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: swatch,
            boxShadow: `0 0 6px ${swatch}aa, inset 1px 1px 0 rgba(255,255,255,0.4)`,
            flexShrink: 0,
          }}
        />
      )}
      <span>{label}</span>
    </label>
  );
}

