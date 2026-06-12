/**
 * API 키 없이 현재 Claude Code 로그인(구독 플랜)으로 도는 시연용 드라이버.
 * Claude Agent SDK가 로컬 Claude Code 바이너리를 스폰하므로 별도 인증이 필요 없다.
 * 대화 연속성은 Claude Code 세션 resume으로 처리한다 (messages를 직접 관리하지 않음).
 */
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { searchVenues } from "./venueSearch";
import type { Venue } from "../src/data/types";

export type SSESend = (event: string, data: unknown) => void;

export interface AgentTurnParams {
  prompt: string;
  systemPrompt: string;
  resumeSessionId?: string;
  venues: Venue[];
  send: SSESend;
}

export interface AgentTurnResult {
  sessionId?: string;
  waitingUser: boolean;
}

export async function runAgentTurn(p: AgentTurnParams): Promise<AgentTurnResult> {
  let waitingUser = false;
  let sessionId = p.resumeSessionId;
  let streamedAny = false;

  const advisor = createSdkMcpServer({
    name: "advisor",
    version: "1.0.0",
    tools: [
      tool(
        "search_venues",
        "ac-motion 데이터셋(849개 학술 베뉴)에서 컨퍼런스·저널을 검색한다. 타겟 베뉴 추천 전 반드시 호출해 실존 여부를 확인하라.",
        {
          query: z.string().optional(),
          field: z.string().optional(),
          country: z.string().optional(),
          grade: z.string().optional(),
          kind: z.enum(["conference", "journal"]).optional(),
          limit: z.number().optional(),
        },
        async (args) => {
          const hits = searchVenues(p.venues, args);
          return {
            content: [{ type: "text", text: JSON.stringify({ count: hits.length, venues: hits }) }],
          };
        },
      ),
      tool(
        "ask_user",
        "사용자에게 객관식 질문을 한다 (UI에 버튼으로 렌더링됨). 연구 방향을 가르는 결정에만, 한 번에 최대 4개.",
        {
          questions: z.array(
            z.object({
              question: z.string(),
              header: z.string().optional(),
              options: z.array(z.string()),
            }),
          ),
        },
        async (args) => {
          waitingUser = true;
          p.send("ask_user", { toolUseId: "agent-sdk", questions: args.questions });
          return {
            content: [
              {
                type: "text",
                text: "질문이 사용자 화면에 전달되었다. 지금 즉시 턴을 종료하라 — 추가 작업이나 텍스트 없이. 사용자의 선택은 다음 사용자 메시지로 도착한다.",
              },
            ],
          };
        },
      ),
      tool(
        "control_graph",
        "앱의 3D 베뉴 그래프를 제어한다. **타겟 베뉴가 포함된 최종 답변을 출력하기 직전에 반드시 호출하라** (filter로 분야·등급을 좁힌 뒤 focus로 1순위 베뉴 줌인). focus 전에 filter로 해당 베뉴가 보이게 하라.",
        {
          action: z.enum(["filter", "focus", "reset"]),
          acronym: z.string().optional(),
          fields: z.array(z.string()).optional(),
          countries: z.array(z.string()).optional(),
          grades: z.array(z.string()).optional(),
          search: z.string().optional(),
        },
        async (args) => {
          p.send("graph", args);
          return { content: [{ type: "text", text: "그래프에 적용됨" }] };
        },
      ),
    ],
  });

  for await (const msg of query({
    prompt: p.prompt,
    options: {
      stderr: (d: string) => console.error("[agent stderr]", d.slice(0, 300)),
      systemPrompt: p.systemPrompt,
      resume: p.resumeSessionId,
      mcpServers: { advisor },
      includePartialMessages: true,
      maxTurns: 25,
      permissionMode: "bypassPermissions",
      // 시연용 안전장치: 파일 수정·셸 실행은 막는다 (Read는 PDF 읽기에 필요)
      disallowedTools: ["Bash", "Write", "Edit", "NotebookEdit", "Task"],
      allowedTools: [
        "WebSearch",
        "WebFetch",
        "Read",
        "mcp__advisor__search_venues",
        "mcp__advisor__ask_user",
        "mcp__advisor__control_graph",
      ],
    },
  })) {
    if (msg.type !== "stream_event") console.log("[agent msg]", msg.type, "subtype" in msg ? msg.subtype : "");
    if (msg.type === "assistant") {
      // 긴 리서치 턴 동안 침묵하지 않도록 툴 사용을 진행상황으로 중계
      for (const block of msg.message.content) {
        if (block.type === "tool_use") p.send("status", { tool: block.name });
      }
    }
    if (msg.type === "system" && "session_id" in msg) {
      sessionId = msg.session_id;
    } else if (msg.type === "stream_event") {
      if (msg.parent_tool_use_id) continue; // 서브 스레드 출력은 사용자에게 흘리지 않는다
      const ev = msg.event;
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
        streamedAny = true;
        p.send("text", { delta: ev.delta.text });
      }
    } else if (msg.type === "result") {
      sessionId = msg.session_id;
      if (!streamedAny && msg.subtype === "success") {
        p.send("text", { delta: msg.result });
      }
      if (msg.subtype !== "success") {
        p.send("error", { message: `에이전트 종료: ${msg.subtype}` });
      }
    }
  }

  return { sessionId, waitingUser };
}
