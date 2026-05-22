import { useEffect, useRef, useState } from "react";
import type { Graph3DHandle } from "./Graph3D";
import type { Filters } from "../data/types";
import { glassButton, glassPanel } from "../styles/glass";

type Step =
  | { type: "caption"; text: string }
  | { type: "wait"; ms: number }
  | { type: "filter"; patch: Partial<Filters> }
  | { type: "focus"; acronym: string }
  | { type: "resetCamera" };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const DEFAULT_FILTERS: Filters = {
  search: "",
  kinds: new Set(["conference", "journal"]),
  grades: new Set(["A*", "A", "Q1", "KCI Top"]),
  fields: new Set(),
  countries: new Set(),
  showRelations: true,
};

const STEPS: Step[] = [
  { type: "caption", text: "ac-motion · IT 학술대회 온톨로지 (3D)" },
  { type: "wait", ms: 2400 },

  { type: "caption", text: "총 849 venue · CORE + ccf-deadlines + 큐레이션 저널" },
  { type: "wait", ms: 3000 },

  { type: "caption", text: "Country → Field → Venue 계층 구조" },
  { type: "wait", ms: 2800 },

  { type: "caption", text: "AI/ML 분야: ICML 2026" },
  { type: "focus", acronym: "ICML" },
  { type: "wait", ms: 3000 },

  { type: "caption", text: "ICML 2026은 한국에서 개최 — Country=South Korea" },
  { type: "wait", ms: 3000 },

  { type: "caption", text: "South Korea 만 필터" },
  { type: "filter", patch: { countries: new Set(["South Korea"]), grades: new Set() } },
  { type: "wait", ms: 3500 },

  { type: "caption", text: "한국 venue 10개 — 컨퍼런스 7 + KCI 저널 3" },
  { type: "wait", ms: 3000 },

  { type: "caption", text: "필터 해제 · Vision/Graphics 분야 보기" },
  { type: "filter", patch: { ...DEFAULT_FILTERS, fields: new Set(["Vision/Graphics"]) } },
  { type: "wait", ms: 2500 },

  { type: "focus", acronym: "CVPR" },
  { type: "caption", text: "CVPR · Vision/Graphics A*" },
  { type: "wait", ms: 3000 },

  { type: "caption", text: "필터 리셋 · 전체 보기" },
  { type: "filter", patch: DEFAULT_FILTERS },
  { type: "resetCamera" },
  { type: "wait", ms: 2500 },

  { type: "caption", text: "키보드/마우스 없이 손 모션으로 검색·탐색" },
  { type: "wait", ms: 3000 },
];

interface Props {
  graphRef: React.RefObject<Graph3DHandle>;
  onFiltersPatch: (patch: Partial<Filters>) => void;
}

export function DemoController({ graphRef, onFiltersPatch }: Props) {
  const [running, setRunning] = useState(false);
  const [caption, setCaption] = useState<string | null>(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (!running) return;
    cancelRef.current = false;
    (async () => {
      for (const step of STEPS) {
        if (cancelRef.current) break;
        if (step.type === "caption") setCaption(step.text);
        else if (step.type === "wait") await sleep(step.ms);
        else if (step.type === "filter") onFiltersPatch(step.patch);
        else if (step.type === "focus") graphRef.current?.focusByAcronym(step.acronym);
        else if (step.type === "resetCamera") graphRef.current?.resetCamera();
      }
      if (!cancelRef.current) setCaption("demo end · click ▶ to replay");
      setRunning(false);
    })();
    return () => {
      cancelRef.current = true;
    };
  }, [running, graphRef, onFiltersPatch]);

  return (
    <>
      <button
        onClick={() => {
          if (running) {
            cancelRef.current = true;
            setRunning(false);
            setCaption(null);
          } else {
            setRunning(true);
          }
        }}
        className="glass-button"
        style={{
          ...glassButton,
          position: "absolute",
          top: 20,
          right: 20,
          fontSize: 12,
          padding: "8px 16px",
        }}
        title={running ? "Stop demo" : "Run demo sequence"}
      >
        {running ? "■ stop demo" : "▶ demo"}
      </button>

      {caption && (
        <div
          style={{
            ...glassPanel,
            position: "absolute",
            top: 70,
            left: "50%",
            transform: "translateX(-50%)",
            padding: "14px 26px",
            fontSize: 16,
            fontWeight: 600,
            letterSpacing: 0.3,
            maxWidth: "70vw",
            textAlign: "center",
            pointerEvents: "none",
            animation: "fadeIn 0.4s ease",
          }}
        >
          {caption}
        </div>
      )}
    </>
  );
}
