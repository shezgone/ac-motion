/**
 * paper-advisor backend: multi-user agentic loop over the Claude API.
 *
 *   ANTHROPIC_API_KEY=sk-... bun run advisor      # http://127.0.0.1:8787
 *
 * POST /api/advisor/chat  (JSON in, SSE out)
 *   { conversationId?, text?, pdfBase64?, pdfName?, answers?: {toolUseId, selections} }
 * SSE events: meta | text | ask_user | graph | done | error
 *
 * Conversations are isolated per id (crypto.randomUUID) and persisted in SQLite,
 * so any number of browser sessions can run concurrently. For a real deployment
 * put authentication in front and key conversations to the authenticated user.
 */
import Anthropic from "@anthropic-ai/sdk";
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { runAgentTurn } from "./agentDriver";
import { searchVenues, listFacets, type VenueQuery } from "./venueSearch";
import type { Venue } from "../src/data/types";
import venuesJson from "../src/data/venues.json";

const PORT = Number(process.env.ADVISOR_PORT ?? 8787);
const MODEL = "claude-opus-4-8";
const MAX_USER_TURNS = 30; // per conversation — crude runaway/cost guard
const MAX_LOOP_ITERATIONS = 12; // per request

const venues = venuesJson as Venue[];
const facets = listFacets(venues);

const db = new Database(new URL("./advisor.db", import.meta.url).pathname);
db.run(`CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  messages TEXT NOT NULL,
  pending TEXT,
  agent_session_id TEXT,
  user_turns INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
try {
  db.run("ALTER TABLE conversations ADD COLUMN agent_session_id TEXT");
} catch {
  /* 컬럼이 이미 있음 */
}

interface ConversationRow {
  messages: string;
  pending: string | null;
  agent_session_id: string | null;
  user_turns: number;
}

function loadConversation(id: string) {
  const row = db
    .query<ConversationRow, [string]>(
      "SELECT messages, pending, agent_session_id, user_turns FROM conversations WHERE id = ?",
    )
    .get(id);
  if (!row) return null;
  return {
    messages: JSON.parse(row.messages) as Anthropic.MessageParam[],
    pending: row.pending ? (JSON.parse(row.pending) as Anthropic.ToolResultBlockParam[]) : [],
    agentSessionId: row.agent_session_id ?? undefined,
    userTurns: row.user_turns,
  };
}

function saveAgentConversation(id: string, sessionId: string | undefined, userTurns: number) {
  db.run(
    `INSERT INTO conversations (id, messages, agent_session_id, user_turns) VALUES (?, '[]', ?, ?)
     ON CONFLICT(id) DO UPDATE SET agent_session_id = excluded.agent_session_id, user_turns = excluded.user_turns`,
    [id, sessionId ?? null, userTurns],
  );
}

function saveConversation(
  id: string,
  messages: Anthropic.MessageParam[],
  pending: Anthropic.ToolResultBlockParam[],
  userTurns: number,
) {
  db.run(
    `INSERT INTO conversations (id, messages, pending, user_turns) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET messages = excluded.messages, pending = excluded.pending, user_turns = excluded.user_turns`,
    [id, JSON.stringify(messages), JSON.stringify(pending), userTurns],
  );
}

const SYSTEM_PROMPT = `당신은 ac-motion 앱에 내장된 논문 연구 방향 어드바이저다. 사용자가 논문 주제(그리고/또는 선행연구 PDF)를 주면, 목표를 질문으로 파악하고 선행연구를 조사해 실제 논문 주제·핵심 주장(claims)·실험 설계를 담은 연구 방향 문서를 작성한다.

## 절차 (순서대로)
1. **입력 분석**: PDF가 있으면 abstract/intro와 특히 limitations/future work를 추출한다 — 연구 갭의 1차 소스다.
2. **사용자에게 질문 (필수, ask_user 도구)**: 새 주제의 **첫 행동은 무조건 ask_user다** — ask_user 전에 WebSearch·web_fetch·search_venues를 호출하는 것은 금지. 반드시 1회 ask_user로 묻는다 — ① 목표 수준(졸업논문/KCI/국제 워크숍/국제 컨퍼런스·저널) ② 기간·리소스 ③ 기여 유형(방법/분석·벤치마크/응용) ④ 입력 논문을 읽고 직접 설계한 주제 특화 질문 1개. 추가 질문은 1회까지만.
3. **선행연구 조사 (web_search/web_fetch)**: 핵심 논문 5~10편을 찾아 접근법 계열로 군집화. **인용 규칙(절대)**: 검색 결과에서 실제 확인된 논문만, 제목+연도+링크(arXiv ID/DOI) 필수. 기억 속 논문은 적지 않는다.
4. **갭 분석 + 주제 제안**: 주제 2~3개를 난이도 라벨(🟢 안전 / 🟡 도전 / 🔴 프런티어)과 함께. 각 주제마다: 제목 초안(국/영문), 방어할 핵심 주장 2~4개, 주장별 검증 방법(실험·베이스라인·메트릭), 타겟 베뉴, 리스크와 폴백.
5. **최종 문서**: 마크다운으로 정리해 답한다 (## 선행연구 지형도(표) / ## 연구 갭 / ## 제안 주제 / ## 리딩 리스트).

## 그래프 연동 (이 앱의 고유 기능 — 필수 절차)
- 타겟 베뉴를 추천하기 전에 **search_venues로 이 앱의 실제 데이터셋에서 검증**하라. 데이터셋에 있는 베뉴는 acronym을 정확히 적는다.
- **최종 연구 방향 문서를 출력하기 직전에 반드시 control_graph를 호출**하라: ① {action:"filter", fields:[...], grades:[...]}로 추천 베뉴들이 보이게 필터 ② {action:"focus", acronym:"..."}로 1순위 타겟 베뉴 줌인. **control_graph 호출 없이 베뉴가 포함된 답변을 끝내는 것은 금지** — 화면 옆 3D 그래프가 반응하는 것이 이 앱의 핵심 경험이다. 새 탐색 시작 시 {action:"reset"}.
- 문서 본문에도 한 줄로 안내하라: "그래프에 OO 분야를 필터하고 XX에 포커스해 두었습니다."
- filter의 유효한 field 값: ${facets.fields.join(", ")}
- filter의 유효한 grade 값: ${facets.grades.join(", ")}

## 금지
- 검증 안 된 논문 인용 · ask_user 단계 생략 · 주제 1개만 제시 · claims 없는 주제 제시 · 데이터셋에 없는 acronym으로 focus 시도`;

const TOOLS = [
  { type: "web_search_20260209" as const, name: "web_search" as const },
  { type: "web_fetch_20260209" as const, name: "web_fetch" as const },
  {
    name: "search_venues",
    description:
      "ac-motion 데이터셋(849개 학술 베뉴: CORE/ccf-deadlines/KCI)에서 컨퍼런스·저널을 검색한다. 타겟 베뉴 추천 전 반드시 호출해 실제 존재하는 베뉴인지 확인하라.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "이름/acronym 부분 일치 검색어" },
        field: { type: "string", description: `분야 (정확히 일치): ${facets.fields.join(", ")}` },
        country: { type: "string", description: "개최국 (예: South Korea, International)" },
        grade: { type: "string", description: `등급 (정확히 일치): ${facets.grades.join(", ")}` },
        kind: { type: "string", enum: ["conference", "journal"] },
        limit: { type: "number", description: "최대 결과 수 (기본 12, 최대 30)" },
      },
    },
  },
  {
    name: "ask_user",
    description:
      "사용자에게 객관식 질문을 한다 (UI에 버튼으로 렌더링됨). 연구 방향을 가르는 결정에만 사용. 한 번에 최대 4개 질문.",
    input_schema: {
      type: "object" as const,
      properties: {
        questions: {
          type: "array",
          maxItems: 4,
          items: {
            type: "object",
            properties: {
              question: { type: "string" },
              header: { type: "string", description: "짧은 라벨 (예: 목표 수준)" },
              options: { type: "array", items: { type: "string" }, description: "선택지 2~4개" },
            },
            required: ["question", "options"],
          },
        },
      },
      required: ["questions"],
    },
  },
  {
    name: "control_graph",
    description:
      "앱의 3D 베뉴 그래프를 제어한다. filter는 화면에 보이는 베뉴를 좁히고, focus는 특정 베뉴로 카메라 줌인(해당 베뉴가 현재 필터에 보여야 함 — focus 전에 filter 먼저), reset은 전체 보기로 복귀.",
    input_schema: {
      type: "object" as const,
      properties: {
        action: { type: "string", enum: ["filter", "focus", "reset"] },
        acronym: { type: "string", description: "focus 대상 베뉴 acronym (search_venues로 확인된 것만)" },
        fields: { type: "array", items: { type: "string" } },
        countries: { type: "array", items: { type: "string" } },
        grades: { type: "array", items: { type: "string" } },
        search: { type: "string", description: "이름 검색 필터" },
      },
      required: ["action"],
    },
  },
];

type SSESend = (event: string, data: unknown) => void;

function buildUserContent(body: ChatBody): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = [];
  if (body.pdfBase64) {
    blocks.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: body.pdfBase64 },
      title: body.pdfName ?? "uploaded.pdf",
      // PDF는 매 턴 재전송되므로 캐시해서 토큰 비용을 줄인다
      cache_control: { type: "ephemeral" },
    });
  }
  if (body.text) blocks.push({ type: "text", text: body.text });
  return blocks;
}

interface ChatBody {
  conversationId?: string;
  text?: string;
  pdfBase64?: string;
  pdfName?: string;
  answers?: { toolUseId: string; selections: Record<string, string> };
}

async function runTurn(
  client: Anthropic,
  conversationId: string,
  messages: Anthropic.MessageParam[],
  userTurns: number,
  send: SSESend,
) {
  let pending: Anthropic.ToolResultBlockParam[] = [];

  for (let i = 0; i < MAX_LOOP_ITERATIONS; i++) {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: TOOLS,
      messages,
    });
    stream.on("text", (delta) => send("text", { delta }));
    const msg = await stream.finalMessage();
    messages.push({ role: "assistant", content: msg.content });

    if (msg.stop_reason === "pause_turn") continue; // 서버사이드 검색 진행 중 — 그대로 재호출

    if (msg.stop_reason !== "tool_use") {
      saveConversation(conversationId, messages, [], userTurns);
      send("done", { state: "answered" });
      return;
    }

    const toolUses = msg.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    const results: Anthropic.ToolResultBlockParam[] = [];
    let waitingToolUseId: string | null = null;

    for (const tu of toolUses) {
      if (tu.name === "search_venues") {
        const hits = searchVenues(venues, tu.input as VenueQuery);
        results.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify({ count: hits.length, venues: hits }),
        });
      } else if (tu.name === "control_graph") {
        send("graph", tu.input); // 클라이언트가 그래프에 즉시 적용 (fire-and-forget)
        results.push({ type: "tool_result", tool_use_id: tu.id, content: "그래프에 적용됨" });
      } else if (tu.name === "ask_user") {
        send("ask_user", { toolUseId: tu.id, ...(tu.input as object) });
        waitingToolUseId = tu.id;
      }
    }

    if (waitingToolUseId) {
      // 사용자 답변 대기: 이미 실행된 다른 툴 결과는 pending으로 보관했다가 답변과 합쳐 보낸다
      pending = results;
      saveConversation(conversationId, messages, pending, userTurns);
      send("done", { state: "waiting_user" });
      return;
    }
    messages.push({ role: "user", content: results });
  }
  saveConversation(conversationId, messages, [], userTurns);
  send("error", { message: "루프 반복 한도 초과 — 다시 시도해 주세요." });
}

function sseResponse(handler: (send: SSESend) => Promise<void>): Response {
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send: SSESend = (event, data) =>
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        await handler(send);
      } catch (e) {
        send("error", { message: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}

Bun.serve({
  port: PORT,
  idleTimeout: 240, // 검색 다수 포함 턴은 길다
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/api/advisor/health") {
      return Response.json({
        ok: true,
        driver: process.env.ANTHROPIC_API_KEY ? "api" : "agent-sdk(구독)",
      });
    }

    if (url.pathname === "/api/advisor/chat" && req.method === "POST") {
      const body = (await req.json()) as ChatBody;
      return sseResponse(async (send) => {
        const conversationId = body.conversationId ?? crypto.randomUUID();
        send("meta", { conversationId });

        const existing = body.conversationId ? loadConversation(body.conversationId) : null;
        if (body.conversationId && !existing) {
          send("error", { message: "존재하지 않는 대화입니다." });
          return;
        }
        const userTurns = (existing?.userTurns ?? 0) + 1;
        if (userTurns > MAX_USER_TURNS) {
          send("error", { message: "이 대화의 턴 한도에 도달했습니다. 새 대화를 시작해 주세요." });
          return;
        }

        // 드라이버 선택: API 키가 없으면 Claude Code 로그인(구독)으로 도는 Agent SDK 경로 (시연용)
        if (!process.env.ANTHROPIC_API_KEY) {
          let prompt = "";
          if (body.answers) {
            prompt += `[ask_user 질문에 대한 사용자 답변] ${JSON.stringify(body.answers.selections)}\n`;
          }
          if (body.pdfBase64) {
            const dir = new URL("./uploads/", import.meta.url).pathname;
            mkdirSync(dir, { recursive: true });
            const pdfPath = `${dir}${conversationId}.pdf`;
            await Bun.write(pdfPath, Buffer.from(body.pdfBase64, "base64"));
            prompt += `첨부된 선행연구 PDF: ${pdfPath}\nRead 도구로 읽어라 — abstract/intro와 특히 limitations/future work 섹션 우선.\n`;
          }
          if (body.text) prompt += body.text;
          if (!prompt) {
            send("error", { message: "메시지가 비어 있습니다." });
            return;
          }
          const r = await runAgentTurn({
            prompt,
            systemPrompt: SYSTEM_PROMPT,
            resumeSessionId: existing?.agentSessionId,
            venues,
            send,
          });
          saveAgentConversation(conversationId, r.sessionId, userTurns);
          send("done", { state: r.waitingUser ? "waiting_user" : "answered" });
          return;
        }

        const client = new Anthropic();
        const messages = existing?.messages ?? [];

        const content: Anthropic.ContentBlockParam[] = [...(existing?.pending ?? [])];
        if (body.answers) {
          content.push({
            type: "tool_result",
            tool_use_id: body.answers.toolUseId,
            content: JSON.stringify(body.answers.selections),
          });
        }
        content.push(...buildUserContent(body));
        if (content.length === 0) {
          send("error", { message: "메시지가 비어 있습니다." });
          return;
        }
        messages.push({ role: "user", content });

        await runTurn(client, conversationId, messages, userTurns, send);
      });
    }

    return new Response("not found", { status: 404 });
  },
});

console.log(`[advisor] listening on http://127.0.0.1:${PORT} · model=${MODEL} · venues=${venues.length}`);
