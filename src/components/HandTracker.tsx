import type { HandMode, UseHandLandmarker } from "../hooks/useHandLandmarker";
import { glassPanel } from "../styles/glass";

function modeLabel(m: HandMode): string {
  switch (m) {
    case "open":
      return "open · orbit";
    case "pinch":
      return "PINCH · select";
    case "fist":
      return "FIST · reset";
    case "two-hand":
      return "TWO-HAND · zoom";
    default:
      return "—";
  }
}

function modeColor(m: HandMode): string {
  switch (m) {
    case "pinch":
      return "#f0a050";
    case "fist":
      return "#f06060";
    case "two-hand":
      return "#a78bfa";
    case "open":
      return "#4ad6a6";
    default:
      return "#aab";
  }
}

interface Props {
  hand: UseHandLandmarker;
}

export function HandTracker({ hand }: Props) {
  const { videoRef, canvasRef, signalRef, status, error } = hand;
  const sig = signalRef.current;

  return (
    <div
      style={{
        ...glassPanel,
        position: "absolute",
        right: 20,
        bottom: 20,
        width: 240,
        padding: 12,
        fontSize: 11,
        fontFamily: "ui-monospace, SFMono-Regular, monospace",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 6,
          opacity: 0.8,
        }}
      >
        <span>hand · {modeLabel(sig.mode)}</span>
        <span
          style={{
            color: status === "running" ? modeColor(sig.mode) : status === "error" ? "#f06060" : "#aab",
          }}
        >
          {status}
        </span>
      </div>
      <video
        ref={videoRef}
        playsInline
        muted
        style={{ display: "none" }}
        width={320}
        height={240}
      />
      <canvas
        ref={canvasRef}
        width={224}
        height={168}
        style={{
          width: "100%",
          display: "block",
          borderRadius: 12,
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)",
        }}
      />
      {status === "error" && (
        <div style={{ marginTop: 6, color: "#f06060", fontSize: 10 }}>{error}</div>
      )}
      {status === "running" && (
        <div style={{ marginTop: 6, opacity: 0.55, fontSize: 10 }}>
          🟢 open · 🟠 pinch · 🔴 fist · 🟣 two-hand —{" "}
          <span style={{ color: "#9bbcff" }}>? motion help</span> 참조
        </div>
      )}
    </div>
  );
}
