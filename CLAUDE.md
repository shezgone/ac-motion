# ac-motion

IT 학술대회/저널을 3D 온톨로지 그래프(Country → Field → Venue)로 보여주고, 웹캠 손 제스처(MediaPipe)로 탐색하는 졸업과제 앱. React 18 + Vite + three.js / react-force-graph-3d. 런타임·패키지 매니저는 **bun**.

## 코드 탐색 — 그래프 우선 (토큰 절약)

`graphify-out/graph.json`에 코드베이스 지식 그래프가 있다 (24 코드 파일 + 문서, AST + 시맨틱). **구조 파악 질문("X는 어디서?", "Y를 누가 호출?")은 파일을 읽기 전에 그래프부터 쿼리할 것:**

- `graphify query "<질문>"` — BFS 컨텍스트 (관련 노드/엣지 + 파일:라인)
- `graphify path "A" "B"` — 두 심볼 간 최단 경로
- `graphify explain "X"` — 노드와 이웃 설명
- 쿼리 결과의 `src=파일 loc=라인`으로 필요한 부분만 Read할 것. 전체 파일 훑기 금지.
- 코드 구조가 크게 바뀌면 `/graphify . --update`로 그래프 갱신 (data/raw·생성 JSON은 제외된 상태 유지).

## 검증 루프 (작업 규칙)

1. `.ts/.tsx` 수정 시 PostToolUse 훅이 자동으로 `bun run typecheck`(증분, ~0.7s)를 실행하고 에러를 피드백한다. 별도로 typecheck를 돌릴 필요 없음.
2. 로직 변경 후: `bun test` — `src/**/*.test.ts` (bun:test).
3. UI/렌더링 변경 후: `bun run snapshot` — headless Chrome으로 앱을 띄워 `.loop/snapshot.png` 캡처 + 런타임 에러 수집. **스크린샷을 Read로 직접 보고** 의도대로 렌더링됐는지 확인할 것. uncaught error가 있으면 non-zero exit.
4. 작업 마무리 전: `bun run verify` = typecheck → test → build → snapshot. 이게 green이어야 완료.

## 명령

| 명령 | 용도 |
|---|---|
| `bun run dev` | dev 서버 (http://127.0.0.1:5173/) |
| `bun test` | 단위 테스트 |
| `bun run snapshot [url] [out.png]` | headless 렌더링 검증 (서버 없으면 자동 기동/종료) |
| `bun run verify` | 전체 게이트 (완료 전 필수) |
| `bun run build:venues` | `data/raw/`(CCF yml + CORE csv) → `src/data/venues.json` + `relations.json` 재생성 |

## paper advisor (다중사용자 LLM 기능)

- `bun run advisor` → 백엔드 (포트 8787, vite가 `/api` 프록시). **드라이버 자동 선택**: `ANTHROPIC_API_KEY` 있으면 Messages API(서비스용), 없으면 Claude Agent SDK가 로컬 Claude Code 로그인(구독)으로 동작(시연용, `server/agentDriver.ts`). 구독 경로는 한 계정 한도를 공유하므로 공개 배포에는 키 사용.
- `server/advisor.ts` — Claude API(claude-opus-4-8) 수동 에이전트 루프 + SQLite 대화 저장(`server/advisor.db`, 대화 ID 단위 멀티유저 격리). 툴: 서버사이드 `web_search`/`web_fetch`(선행연구 조사), `search_venues`(venues.json 그라운딩), `ask_user`(UI 버튼 질문), `control_graph`(3D 그래프 필터/포커스 — SSE `graph` 이벤트로 클라이언트가 실행).
- `src/components/AdvisorPanel.tsx` — 채팅 UI(SSE 소비, PDF 업로드 base64, ask_user 버튼 렌더). 그래프 제어는 DemoController와 같은 `graphRef`/`onFiltersPatch` 패턴.
- 실배포 시 인증을 앞단에 붙이고 대화를 사용자 계정에 키잉할 것. PDF 블록은 `cache_control`로 캐싱됨.

## 구조

- `src/App.tsx` — 필터 상태 + 컴포넌트 조립. 데이터 흐름: `venues.json` → `applyFilters` → `buildGraph` → `<Graph3D>`
- `src/data/buildGraph.ts`, `types.ts` — 순수 로직 (테스트 대상). 그래프 노드 id 규칙: `country:X`, `cf:X:field`, `venue:id`
- `src/components/Graph3D.tsx` — three.js 렌더링; `HandTracker.tsx` + `hooks/useHandLandmarker.ts` — MediaPipe 손 추적
- `src/components/DemoController.tsx` — `▶ demo` 자동 시연 시퀀스 (docs/demo_script.md 참고)

## 주의

- `src/data/venues.json`, `relations.json`은 **생성 파일** — 직접 수정 금지, `bun run build:venues`로 재생성.
- 손 추적은 실제 웹캠이 필요하므로 자동 검증 불가 영역. snapshot은 fake 카메라 플래그로 권한 차단만 우회한다. 제스처 로직 변경 시 사용자에게 수동 확인 요청할 것.
- 데모 영상/발표용 프로젝트이므로 `docs/demo_script.md`의 시나리오(캡션 타이밍, 필터 흐름)를 깨뜨리는 UI 변경은 사전에 언급할 것.
