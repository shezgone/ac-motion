import type { CSSProperties } from "react";

export const glassPanel: CSSProperties = {
  background:
    "linear-gradient(135deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.04) 100%)",
  borderRadius: 22,
  backdropFilter: "blur(40px) saturate(1.8)",
  WebkitBackdropFilter: "blur(40px) saturate(1.8)",
  boxShadow: [
    "inset 1px 1px 0 rgba(255,255,255,0.22)",
    "inset -1px -1px 0 rgba(0,0,0,0.25)",
    "0 0 0 1px rgba(255,255,255,0.06)",
    "0 24px 60px rgba(0,0,0,0.45)",
  ].join(", "),
  color: "#e6e8ee",
  border: "none",
};

export const glassButton: CSSProperties = {
  background:
    "linear-gradient(135deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.07) 100%)",
  borderRadius: 999,
  padding: "6px 14px",
  color: "#e6e8ee",
  cursor: "pointer",
  fontSize: 11,
  fontWeight: 500,
  backdropFilter: "blur(20px) saturate(1.6)",
  WebkitBackdropFilter: "blur(20px) saturate(1.6)",
  boxShadow:
    "inset 1px 1px 0 rgba(255,255,255,0.28), inset -1px -1px 0 rgba(0,0,0,0.18), 0 4px 14px rgba(0,0,0,0.35)",
  border: "none",
  transition: "transform 80ms ease, background 120ms ease",
};

export const glassIconButton: CSSProperties = {
  background: "transparent",
  color: "#aab",
  border: "none",
  cursor: "pointer",
  fontSize: 14,
  borderRadius: 999,
  width: 24,
  height: 24,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

export const glassInput: CSSProperties = {
  background: "rgba(255,255,255,0.07)",
  borderRadius: 14,
  padding: "9px 14px",
  color: "#e6e8ee",
  fontSize: 12,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
  backdropFilter: "blur(20px) saturate(1.5)",
  WebkitBackdropFilter: "blur(20px) saturate(1.5)",
  boxShadow:
    "inset 1px 1px 0 rgba(255,255,255,0.14), inset -1px -1px 0 rgba(0,0,0,0.18)",
  border: "none",
};

export const glassLink: CSSProperties = {
  background: "transparent",
  color: "#9bbcff",
  border: "none",
  padding: "4px 0 0",
  cursor: "pointer",
  fontSize: 11,
  textDecoration: "underline",
  textDecorationColor: "rgba(155,188,255,0.4)",
};
