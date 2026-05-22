import { useCallback, useMemo, useRef, useState } from "react";
import { Graph3D, type Graph3DHandle } from "./components/Graph3D";
import { HandTracker } from "./components/HandTracker";
import { FilterSidebar } from "./components/FilterSidebar";
import { DemoController } from "./components/DemoController";
import { MotionHelp } from "./components/MotionHelp";
import { buildGraph } from "./data/buildGraph";
import { applyFilters, type Filters, type Venue, type VenueRelation } from "./data/types";
import venuesJson from "./data/venues.json";
import relationsJson from "./data/relations.json";
import { useHandLandmarker } from "./hooks/useHandLandmarker";

const allVenues = venuesJson as Venue[];
const allRelations = relationsJson as VenueRelation[];

const DEFAULT_FILTERS: Filters = {
  search: "",
  kinds: new Set<Venue["kind"]>(["conference", "journal"]),
  grades: new Set<string>(["A*", "A", "Q1", "KCI Top"]),
  fields: new Set<string>(),
  countries: new Set<string>(),
  showRelations: true,
};

export function App() {
  const hand = useHandLandmarker();
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const graphRef = useRef<Graph3DHandle>(null);

  const filteredVenues = useMemo(() => applyFilters(allVenues, filters), [filters]);
  const graph = useMemo(
    () => buildGraph(filteredVenues, allRelations, filters.showRelations),
    [filteredVenues, filters.showRelations],
  );

  const patchFilters = useCallback((patch: Partial<Filters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <Graph3D ref={graphRef} data={graph} handSignalRef={hand.signalRef} />
      <FilterSidebar
        allVenues={allVenues}
        shownCount={filteredVenues.length}
        filters={filters}
        onChange={setFilters}
      />
      <HandTracker hand={hand} />
      <DemoController graphRef={graphRef} onFiltersPatch={patchFilters} />
      <MotionHelp />
      <header style={{ position: "absolute", top: 16, left: 20, pointerEvents: "none" }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: 0.3 }}>
          ac-motion · IT venue ontology
        </h1>
        <p style={{ margin: "4px 0 0", fontSize: 12, opacity: 0.65 }}>
          Chrome desktop · webcam · open palm = orbit · pinch = select
        </p>
      </header>
    </div>
  );
}
