import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Graph3DHandle } from "./Graph3D";
import type { Filters } from "../data/types";
import { glassButton, glassPanel } from "../styles/glass";

interface Props {
  graphRef: React.RefObject<Graph3DHandle>;
  onFiltersPatch: (patch: Partial<Filters>) => void;
}

interface ChatItem {
  role: "user" | "assistant";
  text: string;
}

interface AskUserPayload {
  toolUseId: string;
  questions: { question: string; header?: string; options: string[] }[];
}

interface GraphAction {
  action: "filter" | "focus" | "reset";
  acronym?: string;
  fields?: string[];
  countries?: string[];
  grades?: string[];
  search?: string;
}

const TOOL_LABELS: Record<string, string> = {
  WebSearch: "🔍 웹에서 선행연구 검색 중…",
  WebFetch: "📖 문서 확인 중…",
  Read: "📄 PDF 읽는 중…",
  mcp__advisor__search_venues: "🗂 베뉴 데이터셋 검증 중…",
  mcp__advisor__control_graph: "🌐 그래프 조작 중…",
  mcp__advisor__ask_user: "❓ 질문 준비 중…",
};

const RESET_FILTERS: Partial<Filters> = {
  search: "",
  kinds: new Set(["conference", "journal"]),
  grades: new Set(["A*", "A", "Q1", "KCI Top"]),
  fields: new Set(),
  countries: new Set(),
};

function renderInline(text: string): ReactNode[] {
  // **bold** 와 [label](url) 만 처리하는 초소형 인라인 렌더러
  const parts = text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
    const link = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link)
      return (
        <a key={i} href={link[2]} target="_blank" rel="noreferrer" style={{ color: "#8db4ff" }}>
          {link[1]}
        </a>
      );
    return p;
  });
}

function Markdown({ text }: { text: string }) {
  return (
    <div style={{ lineHeight: 1.55 }}>
      {text.split("\n").map((line, i) => {
        const h = line.match(/^(#{1,4})\s+(.*)/);
        if (h)
          return (
            <div key={i} style={{ fontWeight: 700, fontSize: h[1].length <= 2 ? 14 : 13, margin: "10px 0 4px" }}>
              {renderInline(h[2])}
            </div>
          );
        if (/^\s*[-*]\s+/.test(line))
          return (
            <div key={i} style={{ paddingLeft: 14 }}>
              · {renderInline(line.replace(/^\s*[-*]\s+/, ""))}
            </div>
          );
        if (line.startsWith("|"))
          return (
            <div key={i} style={{ fontFamily: "monospace", fontSize: 11, whiteSpace: "pre" }}>
              {line}
            </div>
          );
        return <div key={i}>{line ? renderInline(line) : <br />}</div>;
      })}
    </div>
  );
}

async function consumeSSE(
  res: Response,
  onEvent: (event: string, data: Record<string, unknown>) => void,
) {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("응답 스트림을 열 수 없습니다.");
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const event = chunk.match(/^event: (.*)$/m)?.[1];
      const data = chunk.match(/^data: (.*)$/m)?.[1];
      if (event && data) onEvent(event, JSON.parse(data));
    }
  }
}

export function AdvisorPanel({ graphRef, onFiltersPatch }: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [draft, setDraft] = useState("");
  const [pdf, setPdf] = useState<{ name: string; base64: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingAsk, setPendingAsk] = useState<AskUserPayload | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const conversationIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [items, pendingAsk]);

  const applyGraphAction = useCallback(
    (a: GraphAction) => {
      if (a.action === "reset") {
        onFiltersPatch(RESET_FILTERS);
        graphRef.current?.resetCamera();
        return;
      }
      if (a.action === "filter") {
        const patch: Partial<Filters> = {};
        if (a.fields) patch.fields = new Set(a.fields);
        if (a.countries) patch.countries = new Set(a.countries);
        if (a.grades) patch.grades = new Set(a.grades);
        if (a.search !== undefined) patch.search = a.search;
        onFiltersPatch(patch);
        return;
      }
      if (a.action === "focus" && a.acronym) {
        // 필터 적용 직후 그래프 재구성 시간을 약간 준다
        const acronym = a.acronym;
        setTimeout(() => graphRef.current?.focusByAcronym(acronym), 600);
      }
    },
    [graphRef, onFiltersPatch],
  );

  const send = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      setPendingAsk(null);
      setSelections({});
      setItems((prev) => [...prev, { role: "assistant", text: "" }]);
      try {
        const res = await fetch("/api/advisor/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId: conversationIdRef.current, ...body }),
        });
        await consumeSSE(res, (event, data) => {
          if (event === "meta") conversationIdRef.current = data.conversationId as string;
          else if (event === "status")
            setStatus(TOOL_LABELS[data.tool as string] ?? `⚙️ ${data.tool} 실행 중…`);
          else if (event === "text") {
            setStatus(null);
            setItems((prev) => {
              const next = [...prev];
              next[next.length - 1] = {
                role: "assistant",
                text: next[next.length - 1].text + (data.delta as string),
              };
              return next;
            });
          } else if (event === "graph") applyGraphAction(data as unknown as GraphAction);
          else if (event === "ask_user") {
            setStatus(null);
            setPendingAsk(data as unknown as AskUserPayload);
          }
          else if (event === "error")
            setItems((prev) => [...prev, { role: "assistant", text: `⚠️ ${data.message}` }]);
        });
      } catch (e) {
        setItems((prev) => [
          ...prev,
          { role: "assistant", text: `⚠️ ${e instanceof Error ? e.message : String(e)}` },
        ]);
      } finally {
        setBusy(false);
        setStatus(null);
      }
    },
    [applyGraphAction],
  );

  const submitText = () => {
    if (!draft.trim() && !pdf) return;
    const label = pdf ? `📄 ${pdf.name}\n${draft}` : draft;
    setItems((prev) => [...prev, { role: "user", text: label }]);
    void send({ text: draft || undefined, pdfBase64: pdf?.base64, pdfName: pdf?.name });
    setDraft("");
    setPdf(null);
  };

  const submitAnswers = () => {
    if (!pendingAsk) return;
    const answered = pendingAsk.questions.every((q) => selections[q.question]);
    if (!answered) return;
    setItems((prev) => [
      ...prev,
      { role: "user", text: Object.values(selections).join(" · ") },
    ]);
    void send({ answers: { toolUseId: pendingAsk.toolUseId, selections } });
  };

  const onPickPdf = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result).split(",")[1] ?? "";
      setPdf({ name: file.name, base64 });
    };
    reader.readAsDataURL(file);
  };

  if (!open) {
    return (
      <button
        style={{ ...glassButton, position: "absolute", right: 271, top: 20, fontSize: 12, padding: "8px 14px" }}
        onClick={() => setOpen(true)}
      >
        ✦ advisor
      </button>
    );
  }

  return (
    <div
      style={{
        ...glassPanel,
        position: "absolute",
        right: 16,
        top: 60,
        width: 400,
        height: "min(640px, 80vh)",
        display: "flex",
        flexDirection: "column",
        padding: 14,
        fontSize: 13,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <strong>✦ paper advisor</strong>
        <button style={{ ...glassButton, padding: "2px 10px" }} onClick={() => setOpen(false)}>
          ×
        </button>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", paddingRight: 4 }}>
        {items.length === 0 && (
          <div style={{ opacity: 0.6 }}>
            논문 주제를 입력하거나 선행연구 PDF를 첨부하세요. 목표 수준을 질문으로 확인한 뒤
            선행연구를 조사해 연구 방향을 제안하고, 타겟 베뉴를 그래프에 표시합니다.
          </div>
        )}
        {items.map((m, i) => (
          <div
            key={i}
            style={{
              margin: "8px 0",
              padding: "8px 10px",
              borderRadius: 10,
              background: m.role === "user" ? "rgba(91,141,239,0.18)" : "rgba(255,255,255,0.05)",
              whiteSpace: m.role === "user" ? "pre-wrap" : undefined,
            }}
          >
            {m.role === "user" ? m.text : <Markdown text={m.text || (busy && i === items.length - 1 ? "…" : "")} />}
          </div>
        ))}

        {status && (
          <div style={{ margin: "4px 0", fontSize: 12, opacity: 0.65, fontStyle: "italic" }}>
            {status}
          </div>
        )}

        {pendingAsk &&
          pendingAsk.questions.map((q) => (
            <div key={q.question} style={{ margin: "10px 0" }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>
                {q.header ? `[${q.header}] ` : ""}
                {q.question}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {q.options.map((opt) => (
                  <button
                    key={opt}
                    style={{
                      ...glassButton,
                      padding: "4px 10px",
                      outline:
                        selections[q.question] === opt ? "2px solid #8db4ff" : undefined,
                    }}
                    onClick={() => setSelections((s) => ({ ...s, [q.question]: opt }))}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          ))}
        {pendingAsk && (
          <button
            style={{ ...glassButton, marginTop: 6, opacity: pendingAsk.questions.every((q) => selections[q.question]) ? 1 : 0.4 }}
            onClick={submitAnswers}
          >
            답변 보내기
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <label style={{ ...glassButton, padding: "6px 10px", cursor: "pointer" }}>
          📄
          <input
            type="file"
            accept="application/pdf"
            style={{ display: "none" }}
            onChange={(e) => onPickPdf(e.target.files?.[0])}
          />
        </label>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && submitText()}
          placeholder={pdf ? `${pdf.name} 첨부됨 — 주제/질문 입력` : "논문 주제 또는 질문…"}
          disabled={busy}
          style={{
            flex: 1,
            background: "rgba(255,255,255,0.07)",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 8,
            color: "inherit",
            padding: "6px 10px",
          }}
        />
        <button style={{ ...glassButton }} disabled={busy} onClick={submitText}>
          {busy ? "…" : "전송"}
        </button>
      </div>
    </div>
  );
}
