import { useEffect, useState } from "react";
import { glassButton, glassIconButton, glassPanel } from "../styles/glass";

interface Gesture {
  emoji: string;
  color: string;
  name: string;
  desc: string;
  tip: string;
}

const GESTURES: Gesture[] = [
  {
    emoji: "🖐",
    color: "#4ad6a6",
    name: "펼친 손",
    desc: "그래프 회전 (orbit) + 커서 근처 노드 hover 미리보기",
    tip: "손바닥 정면, 카메라와 30~50cm 거리. 천천히 움직일 것 — 빠르면 인식 끊김",
  },
  {
    emoji: "🤏",
    color: "#f0a050",
    name: "핀치",
    desc: "엄지+검지 끝을 모음 → 화면 커서 위치에서 가장 가까운 venue 노드 선택 (줌인 + 상세 카드)",
    tip: "엄지·검지 끝이 닿거나 거의 닿게. 손이 너무 멀면 펼친 상태에서도 핀치로 오인식",
  },
  {
    emoji: "✊",
    color: "#f06060",
    name: "주먹",
    desc: "네 손가락을 모두 말아 쥠 → 카메라 리셋 (초기 위치로 1초 트랜지션)",
    tip: "엄지 위치는 무관. 1.5초 쿨다운 동안 다시 안 트리거됨",
  },
  {
    emoji: "🙌",
    color: "#a78bfa",
    name: "양손",
    desc: "두 손이 동시에 보이면 손 사이 거리로 줌 — 벌리면 줌인, 모으면 줌아웃",
    tip: "양손이 보이는 동안 회전·핀치는 잠금. 한 손 내리면 다시 회전 모드",
  },
];

interface Props {
  autoOpenFirstTime?: boolean;
}

const STORAGE_KEY = "ac-motion:help-seen";

export function MotionHelp({ autoOpenFirstTime = true }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!autoOpenFirstTime) return;
    if (typeof window === "undefined") return;
    if (!window.localStorage.getItem(STORAGE_KEY)) {
      const t = setTimeout(() => setOpen(true), 1500);
      return () => clearTimeout(t);
    }
  }, [autoOpenFirstTime]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const close = () => {
    setOpen(false);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, "1");
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="glass-button"
        style={{
          ...glassButton,
          position: "absolute",
          top: 20,
          right: 142,
          fontSize: 12,
          padding: "8px 14px",
        }}
        title="Motion gestures guide"
      >
        ? motion help
      </button>

      {open && (
        <div
          onClick={close}
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(6,8,13,0.55)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
            animation: "fadeIn 0.2s ease",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              ...glassPanel,
              width: 520,
              maxWidth: "92vw",
              maxHeight: "86vh",
              padding: 24,
              overflowY: "auto",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 16,
              }}
            >
              <strong style={{ fontSize: 18, letterSpacing: 0.3 }}>
                모션 컨트롤 가이드
              </strong>
              <button
                onClick={close}
                className="glass-icon-button"
                style={{
                  ...glassIconButton,
                  width: 32,
                  height: 32,
                  fontSize: 18,
                }}
                title="Close (Esc)"
              >
                ×
              </button>
            </div>

            <p style={{ margin: "0 0 16px", fontSize: 12, opacity: 0.7, lineHeight: 1.55 }}>
              웹캠으로 손을 인식해 그래프를 조작합니다. 카메라 권한이 필요하며 Chrome
              데스크톱 환경에서만 동작합니다. 손이 카메라에 잘 보이도록 조명을 충분히 해주세요.
            </p>

            <div style={{ display: "grid", gap: 14 }}>
              {GESTURES.map((g) => (
                <GestureRow key={g.name} g={g} />
              ))}
            </div>

            <div
              style={{
                marginTop: 18,
                paddingTop: 14,
                borderTop: "1px solid rgba(255,255,255,0.08)",
                fontSize: 11,
                opacity: 0.65,
                lineHeight: 1.6,
              }}
            >
              <strong style={{ opacity: 0.85 }}>우선순위</strong>: 양손 → 주먹 → 핀치 → 펼친 손.
              여러 모드가 동시 인식되면 위 순서대로 적용됩니다.
              <br />
              <strong style={{ opacity: 0.85 }}>마우스/키보드 백업</strong>: 마우스 드래그로
              회전, 휠로 줌, 노드 클릭으로 선택 — 모션과 함께 사용 가능합니다.
              <br />
              <strong style={{ opacity: 0.85 }}>잘 안 될 때</strong>: 카메라 정면, 손과 카메라
              거리 30~50cm, 배경에 다른 손/얼굴이 적게 보이도록.
            </div>

            <button
              onClick={close}
              className="glass-button"
              style={{ ...glassButton, marginTop: 16, width: "100%", fontSize: 13, padding: "10px 14px" }}
            >
              시작하기
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function GestureRow({ g }: { g: Gesture }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "44px 1fr",
        gap: 14,
        alignItems: "start",
        padding: "10px 12px",
        background: "rgba(255,255,255,0.04)",
        borderRadius: 12,
        boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.06)`,
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${g.color}55 0%, ${g.color}11 70%)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 22,
          boxShadow: `inset 0 0 0 1px ${g.color}66, 0 0 12px ${g.color}55`,
        }}
      >
        {g.emoji}
      </div>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: g.color,
              boxShadow: `0 0 6px ${g.color}aa`,
            }}
          />
          <strong style={{ fontSize: 14 }}>{g.name}</strong>
        </div>
        <div style={{ fontSize: 12, opacity: 0.85, lineHeight: 1.5, marginBottom: 4 }}>
          {g.desc}
        </div>
        <div style={{ fontSize: 11, opacity: 0.55, lineHeight: 1.5 }}>
          💡 {g.tip}
        </div>
      </div>
    </div>
  );
}
