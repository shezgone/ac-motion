import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import ForceGraph3D, { type ForceGraphMethods } from "react-force-graph-3d";
import * as THREE from "three";
import type { GraphData, GraphNode } from "../data/types";
import type { HandSignal } from "../hooks/useHandLandmarker";
import { glassButton, glassPanel } from "../styles/glass";

export interface Graph3DHandle {
  focusByAcronym: (acronym: string) => boolean;
  focusByNodeId: (id: string) => boolean;
  resetCamera: () => void;
}

interface Props {
  data: GraphData;
  handSignalRef?: React.MutableRefObject<HandSignal>;
}

const ORBIT_SPEED = 4;
const PICK_THRESHOLD_PX = 70;
const CURSOR_DEADZONE = 0.004;
const ZOOM_SPEED = 600; // higher = more aggressive two-hand zoom
const ZOOM_DEADZONE = 0.003;
const ZOOM_MIN_DIST = 60;
const ZOOM_MAX_DIST = 900;
const HOVER_PICK_PX = 60;
const FIST_RESET_COOLDOWN_MS = 1500;

export const Graph3D = forwardRef<Graph3DHandle, Props>(function Graph3D(
  { data, handSignalRef },
  ref,
) {
  const fgRef = useRef<ForceGraphMethods<GraphNode>>();
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [frozen, setFrozen] = useState(false);

  // 필터 등으로 데이터가 바뀌면 레이아웃 재계산이 필요하므로 정지 자동 해제
  useEffect(() => {
    setFrozen(false);
    // dev 전용: E2E 테스트가 노드 좌표(레이아웃 정지 여부)를 검증할 수 있게 노출
    if (import.meta.env.DEV) {
      (window as unknown as { __acmotionNodes?: GraphNode[] }).__acmotionNodes = data.nodes;
    }
  }, [data]);

  const toggleFrozen = useCallback(() => {
    setFrozen((prev) => {
      const next = !prev;
      if (!next) fgRef.current?.d3ReheatSimulation();
      return next;
    });
  }, []);

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const focusOnNode = useCallback((node: GraphNode) => {
    setSelected(node);
    const fg = fgRef.current;
    if (!fg) return;
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const z = node.z ?? 0;
    const dist = 80;
    const distRatio = 1 + dist / Math.max(1, Math.hypot(x, y, z));
    fg.cameraPosition({ x: x * distRatio, y: y * distRatio, z: z * distRatio }, { x, y, z }, 800);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      focusByAcronym: (acronym) => {
        const node = data.nodes.find(
          (n) => n.kind === "venue" && n.venue?.acronym?.toUpperCase() === acronym.toUpperCase(),
        );
        if (!node) return false;
        focusOnNode(node);
        return true;
      },
      focusByNodeId: (id) => {
        const node = data.nodes.find((n) => n.id === id);
        if (!node) return false;
        focusOnNode(node);
        return true;
      },
      resetCamera: () => {
        setSelected(null);
        fgRef.current?.cameraPosition({ x: 0, y: 0, z: 380 }, { x: 0, y: 0, z: 0 }, 1200);
      },
    }),
    [data, focusOnNode],
  );

  useEffect(() => {
    if (!handSignalRef) return;
    let raf = 0;
    let prevCursor = { x: 0.5, y: 0.5 };
    let prevPinching = false;
    let prevFist = false;
    let prevHadHand = false;
    let prevTwoHand = false;
    let prevSpan = 0;
    let lastReset = 0;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const fg = fgRef.current;
      const sig = handSignalRef.current;

      if (!fg || !sig.hasHand) {
        prevHadHand = false;
        prevTwoHand = false;
        setHoveredId(null);
        return;
      }

      // First frame after hand appears: capture baseline only
      if (!prevHadHand) {
        prevCursor = sig.cursor;
        prevPinching = sig.pinching;
        prevFist = sig.fist;
        prevTwoHand = sig.hasSecondHand;
        prevSpan = sig.twoHandSpan;
        prevHadHand = true;
        return;
      }

      // FIST → reset camera (rising edge + cooldown)
      if (sig.fist && !prevFist && performance.now() - lastReset > FIST_RESET_COOLDOWN_MS) {
        setSelected(null);
        setHoveredId(null);
        fg.cameraPosition({ x: 0, y: 0, z: 380 }, { x: 0, y: 0, z: 0 }, 1000);
        lastReset = performance.now();
        prevFist = true;
        prevTwoHand = sig.hasSecondHand;
        prevSpan = sig.twoHandSpan;
        prevCursor = sig.cursor;
        return;
      }

      // TWO HANDS → spread/contract = zoom in/out
      if (sig.hasSecondHand) {
        // First two-hand frame: only capture span baseline
        if (!prevTwoHand) {
          prevSpan = sig.twoHandSpan;
          prevTwoHand = true;
          setHoveredId(null);
        } else {
          const dSpan = sig.twoHandSpan - prevSpan;
          if (Math.abs(dSpan) > ZOOM_DEADZONE) {
            zoomCamera(fg, dSpan);
          }
          prevSpan = sig.twoHandSpan;
        }
        prevCursor = sig.cursor;
        prevPinching = sig.pinching;
        prevFist = sig.fist;
        return;
      }
      prevTwoHand = false;

      // PINCH rising edge → pick + focus
      if (sig.pinching && !prevPinching) {
        const node = pickNearestNode(sig.cursor, fg, data.nodes, PICK_THRESHOLD_PX);
        if (node) {
          focusOnNode(node);
          setHoveredId(null);
        }
      } else if (!sig.pinching && !sig.fist) {
        // OPEN PALM → orbit + hover preview
        const dx = sig.cursor.x - prevCursor.x;
        const dy = sig.cursor.y - prevCursor.y;
        if (Math.abs(dx) > CURSOR_DEADZONE || Math.abs(dy) > CURSOR_DEADZONE) {
          orbitCamera(fg, dx, dy);
        }
        const hover = pickNearestNode(sig.cursor, fg, data.nodes, HOVER_PICK_PX);
        setHoveredId(hover?.id ?? null);
      }

      prevCursor = sig.cursor;
      prevPinching = sig.pinching;
      prevFist = sig.fist;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [handSignalRef, data, focusOnNode]);

  return (
    <>
      <ForceGraph3D
        ref={fgRef}
        graphData={data}
        cooldownTicks={frozen ? 0 : Infinity}
        width={size.w}
        height={size.h}
        backgroundColor="#06080d"
        nodeLabel={(n) => (n as GraphNode).label}
        nodeVal={(n) => (n as GraphNode).val}
        nodeRelSize={4}
        nodeThreeObjectExtend={false}
        nodeThreeObject={(n) => nodeObjectFor(n as GraphNode)}
        linkColor={(l) => linkColorFor(l)}
        linkWidth={(l) => linkWidthFor(l)}
        linkOpacity={0.7}
        linkCurvature={(l) => linkCurvatureFor(l)}
        linkDirectionalParticles={(l) => linkParticlesFor(l)}
        linkDirectionalParticleWidth={1.4}
        linkDirectionalParticleSpeed={0.006}
        onNodeClick={(n) => focusOnNode(n as GraphNode)}
      />
      <button
        onClick={toggleFrozen}
        style={{
          ...glassButton,
          position: "absolute",
          top: 20,
          right: 375,
          fontSize: 12,
          padding: "8px 14px",
          ...(frozen ? { outline: "1.5px solid #ffd770" } : {}),
        }}
        title="레이아웃 정지/재개 — 카메라·선택은 계속 동작"
      >
        {frozen ? "▶ resume" : "⏸ freeze"}
      </button>
      {selected && <DetailCard node={selected} onClose={() => setSelected(null)} />}
      {hoveredId && !selected && <HoverHud node={data.nodes.find((n) => n.id === hoveredId) ?? null} />}
    </>
  );
});

function HoverHud({ node }: { node: GraphNode | null }) {
  if (!node) return null;
  return (
    <div
      style={{
        ...glassPanel,
        position: "absolute",
        bottom: 20,
        left: "50%",
        transform: "translateX(-50%)",
        padding: "8px 18px",
        fontSize: 13,
        fontWeight: 600,
        letterSpacing: 0.3,
        pointerEvents: "none",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: node.color,
          boxShadow: `0 0 6px ${node.color}aa`,
        }}
      />
      <span>{node.label}</span>
      <span style={{ opacity: 0.55, fontSize: 11, fontWeight: 400 }}>
        {node.kind === "venue" ? `pinch to select` : node.kind}
      </span>
    </div>
  );
}

const LABEL_STYLE: Record<GraphNode["kind"], { color: string; size: number; weight: string; worldHeight: number } | null> = {
  country: { color: "#dfe7ff", size: 64, weight: "700", worldHeight: 7 },
  field: { color: "#e8d4ff", size: 44, weight: "600", worldHeight: 5 },
  venue: null,
};

const SPHERE_GEOM = new THREE.SphereGeometry(1, 20, 16);
const OCTA_GEOM = new THREE.OctahedronGeometry(1, 0);
const BOX_GEOM = new THREE.BoxGeometry(1.55, 1.55, 1.55);

function geomFor(kind: GraphNode["kind"]): THREE.BufferGeometry {
  switch (kind) {
    case "country":
      return SPHERE_GEOM;
    case "field":
      return OCTA_GEOM;
    case "venue":
      return BOX_GEOM;
  }
}

const matCache = new Map<string, THREE.Material>();
function getMaterial(color: string): THREE.Material {
  let m = matCache.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.95 });
    matCache.set(color, m);
  }
  return m;
}

const spriteCache = new Map<string, THREE.Sprite>();

function makeLabelSprite(label: string, style: NonNullable<typeof LABEL_STYLE["country"]>): THREE.Sprite {
  const key = `${style.size}:${style.weight}:${label}`;
  const hit = spriteCache.get(key);
  if (hit) return hit.clone();

  const padding = 16;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  ctx.font = `${style.weight} ${style.size}px system-ui, -apple-system, sans-serif`;
  const textWidth = ctx.measureText(label).width;
  canvas.width = Math.ceil(textWidth + padding * 2);
  canvas.height = style.size + padding * 2;

  ctx.font = `${style.weight} ${style.size}px system-ui, -apple-system, sans-serif`;
  ctx.fillStyle = "rgba(6,8,13,0.7)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = style.color;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(label, padding, canvas.height / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  const aspect = canvas.width / canvas.height;
  sprite.scale.set(style.worldHeight * aspect, style.worldHeight, 1);

  spriteCache.set(key, sprite);
  return sprite.clone();
}

function nodeObjectFor(node: GraphNode): THREE.Object3D {
  const group = new THREE.Group();

  const radius = 4 * Math.cbrt(node.val);
  const mesh = new THREE.Mesh(geomFor(node.kind), getMaterial(node.color));
  mesh.scale.setScalar(radius);
  group.add(mesh);

  const style = LABEL_STYLE[node.kind];
  if (style) {
    const sprite = makeLabelSprite(node.label, style);
    sprite.position.set(0, radius + style.worldHeight * 0.6, 0);
    group.add(sprite);
  }

  return group;
}

type LinkLike = {
  source?: string | number | GraphNode;
  target?: string | number | GraphNode;
  linkKind?: "tier" | "related" | "fieldBond";
};

function srcKind(l: LinkLike): GraphNode["kind"] | null {
  const s = l.source;
  return typeof s === "object" && s !== null ? (s as GraphNode).kind : null;
}

function linkColorFor(l: LinkLike): string {
  if (l.linkKind === "fieldBond") return "rgba(155,107,255,0.28)";
  if (l.linkKind === "related") return "rgba(255,225,180,0.55)";
  switch (srcKind(l)) {
    case "country":
      return "rgba(91,141,239,0.55)";
    case "field":
      return "rgba(155,107,255,0.45)";
    default:
      return "rgba(180,190,210,0.35)";
  }
}

function linkWidthFor(l: LinkLike): number {
  if (l.linkKind === "fieldBond") return 0.4;
  if (l.linkKind === "related") return 0.6;
  switch (srcKind(l)) {
    case "country":
      return 1.6;
    case "field":
      return 0.9;
    default:
      return 0.5;
  }
}

function linkParticlesFor(l: LinkLike): number {
  if (l.linkKind === "fieldBond") return 0;
  if (l.linkKind === "related") return 1;
  switch (srcKind(l)) {
    case "country":
      return 2;
    case "field":
      return 1;
    default:
      return 0;
  }
}

function linkCurvatureFor(l: LinkLike): number {
  if (l.linkKind === "fieldBond") return 0.2;
  return l.linkKind === "related" ? 0.3 : 0;
}

function orbitCamera(
  fg: ForceGraphMethods<GraphNode>,
  dx: number,
  dy: number,
) {
  const cam = fg.camera();
  const pos = cam.position;
  const dist = pos.length();
  if (dist < 1e-3) return;
  const theta = Math.atan2(pos.x, pos.z) - dx * ORBIT_SPEED;
  const phi = Math.max(
    0.15,
    Math.min(Math.PI - 0.15, Math.acos(pos.y / dist) - dy * ORBIT_SPEED),
  );
  fg.cameraPosition(
    {
      x: dist * Math.sin(phi) * Math.sin(theta),
      y: dist * Math.cos(phi),
      z: dist * Math.sin(phi) * Math.cos(theta),
    },
    { x: 0, y: 0, z: 0 },
    0,
  );
}

function pickNearestNode(
  cursor: { x: number; y: number },
  fg: ForceGraphMethods<GraphNode>,
  nodes: GraphNode[],
  thresholdPx: number = PICK_THRESHOLD_PX,
): GraphNode | null {
  const cam = fg.camera();
  const renderer = fg.renderer();
  const w = renderer.domElement.clientWidth;
  const h = renderer.domElement.clientHeight;
  const targetX = cursor.x * w;
  const targetY = cursor.y * h;
  const v = new THREE.Vector3();
  let best: GraphNode | null = null;
  let bestDist = Infinity;
  for (const n of nodes) {
    if (n.x == null || n.y == null || n.z == null) continue;
    v.set(n.x, n.y, n.z).project(cam);
    if (v.z > 1) continue;
    const px = (v.x * 0.5 + 0.5) * w;
    const py = (-v.y * 0.5 + 0.5) * h;
    const d = Math.hypot(px - targetX, py - targetY);
    if (d < bestDist) {
      bestDist = d;
      best = n;
    }
  }
  return bestDist < thresholdPx ? best : null;
}

function zoomCamera(fg: ForceGraphMethods<GraphNode>, dSpan: number) {
  const cam = fg.camera();
  const pos = cam.position;
  const dist = pos.length();
  if (dist < 1e-3) return;
  const newDist = Math.max(ZOOM_MIN_DIST, Math.min(ZOOM_MAX_DIST, dist - dSpan * ZOOM_SPEED));
  const ratio = newDist / dist;
  fg.cameraPosition(
    { x: pos.x * ratio, y: pos.y * ratio, z: pos.z * ratio },
    undefined,
    0,
  );
}

function faviconUrl(siteUrl: string, size = 32): string | null {
  try {
    const u = new URL(siteUrl);
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=${size}`;
  } catch {
    return null;
  }
}

function DetailCard({ node, onClose }: { node: GraphNode; onClose: () => void }) {
  const fav = node.venue ? faviconUrl(node.venue.url, 32) : null;
  return (
    <aside
      style={{
        ...glassPanel,
        position: "absolute",
        right: 20,
        top: 80,
        width: 300,
        padding: 18,
        fontSize: 13,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
          gap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          {fav && (
            <img
              src={fav}
              alt=""
              width={24}
              height={24}
              style={{ flexShrink: 0, borderRadius: 4, background: "#fff" }}
              onError={(e) => ((e.currentTarget.style.display = "none"))}
            />
          )}
          <strong style={{ fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {node.label}
          </strong>
        </div>
        <button
          onClick={onClose}
          className="glass-icon-button"
          style={{
            background: "transparent",
            color: "#aab",
            border: "none",
            cursor: "pointer",
            fontSize: 18,
            width: 28,
            height: 28,
            borderRadius: 999,
            flexShrink: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          ×
        </button>
      </div>
      <div
        style={{
          opacity: 0.6,
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: 1,
          marginBottom: 8,
        }}
      >
        {node.kind}
      </div>
      {node.venue && (
        <>
          <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 10, lineHeight: 1.4 }}>
            {node.venue.name}
          </div>
          <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 12px" }}>
            {node.venue.acronym && (
              <>
                <dt style={{ opacity: 0.6 }}>Acronym</dt>
                <dd style={{ margin: 0 }}>{node.venue.acronym}</dd>
              </>
            )}
            <dt style={{ opacity: 0.6 }}>Field</dt>
            <dd style={{ margin: 0 }}>{node.venue.field}</dd>
            <dt style={{ opacity: 0.6 }}>Grade</dt>
            <dd style={{ margin: 0 }}>{node.venue.grade}</dd>
            {node.venue.country && (
              <>
                <dt style={{ opacity: 0.6 }}>Country</dt>
                <dd style={{ margin: 0 }}>{node.venue.country}</dd>
              </>
            )}
            {node.venue.deadline && (
              <>
                <dt style={{ opacity: 0.6 }}>Deadline</dt>
                <dd style={{ margin: 0 }}>{node.venue.deadline}</dd>
              </>
            )}
            <dt style={{ opacity: 0.6 }}>Source</dt>
            <dd style={{ margin: 0, fontSize: 11, opacity: 0.8 }}>{node.venue.source}</dd>
            <dt style={{ opacity: 0.6 }}>Site</dt>
            <dd style={{ margin: 0 }}>
              <a
                href={node.venue.url}
                target="_blank"
                rel="noreferrer"
                style={{ color: "#7aa8ff" }}
              >
                open ↗
              </a>
            </dd>
          </dl>
        </>
      )}
    </aside>
  );
}
