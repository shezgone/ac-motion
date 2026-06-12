# ac-motion

**손동작으로 탐색하는 IT 학술 베뉴 3D 온톨로지 + AI 연구 방향 어드바이저**

CORE 랭킹·ccf-deadlines·KCI 큐레이션을 통합한 849개 학술 베뉴(컨퍼런스+저널)를
Country → Field → Venue 계층의 3D 그래프로 시각화하고, 웹캠 손동작만으로 탐색합니다.
LLM 어드바이저가 논문 주제를 받아 선행연구를 조사하고 연구 방향을 설계하며,
추천한 타겟 베뉴를 3D 그래프에 직접 필터·포커스합니다.

> 단국대학교 대학원 프로젝트 · 데모 시나리오는 [docs/demo_script.md](docs/demo_script.md) 참고

## 주요 기능

### 🌐 3D 베뉴 온톨로지
- 849 베뉴 (CORE ICORE2026 + ccf-deadlines + KCI 저널 시드)
- 국가(구) → 분야(다이아몬드) → 베뉴(큐브, 등급별 색상) 계층 + 관련도 엣지
- 분야 필터 활성 시 나라별로 흩어진 같은 분야 노드를 한 군집으로 묶는 fieldBond 엣지
- ⏸ freeze — force 레이아웃만 정지 (카메라·선택·제스처는 유지), 발표 중 화면 고정용
- ▶ demo — 캡션·필터·카메라 자동 시연 시퀀스 (~35초)

### ✋ 모션 인터랙션 (MediaPipe HandLandmarker)
- 손바닥 펴기 = 카메라 궤도 회전 · 핀치 = 노드 선택/줌인
- 주먹 = 카메라 리셋 · 양손 = 줌 인/아웃
- 전부 온디바이스 추론 — 웹캠 영상이 외부로 전송되지 않음

### ✦ paper advisor (AI 연구 방향 어드바이저)
논문 주제(또는 선행연구 PDF)를 입력하면:
1. 목표 수준·기간·기여 유형을 **객관식 버튼으로 질문** (주제 특화 질문은 모델이 직접 설계)
2. 웹 검색으로 선행연구 조사 — **검증된 인용만** (링크 필수, 환각 차단)
3. 난이도별(🟢/🟡/🔴) 주제 2~3개 + 방어할 주장(claims) + 실험 설계 제안
4. 타겟 베뉴를 자체 데이터셋에서 실존 검증 후 **3D 그래프에 자동 필터·포커스**

- 다중사용자: 대화를 UUID 단위로 SQLite에 격리, 턴/루프 상한으로 비용 가드
- 듀얼 드라이버: `ANTHROPIC_API_KEY` 있으면 Messages API(서비스용), 없으면
  Claude Agent SDK가 로컬 Claude Code 로그인(구독)으로 동작(시연용, API 비용 0)

## 실행 방법

요구사항: [bun](https://bun.sh) · Chrome (데스크톱) · 웹캠 · (어드바이저) Claude Code 로그인 또는 API 키

```bash
bun install

# 터미널 1 — AI 어드바이저 백엔드 (:8787)
bun run advisor                          # 구독 모드 (Claude Code 로그인 재사용)
# 또는 ANTHROPIC_API_KEY=sk-... bun run advisor   # API 모드

# 터미널 2 — 웹앱 (:5173, /api는 8787로 프록시)
bun run dev
```

Chrome에서 `http://127.0.0.1:5173/` 접속 → 카메라 권한 허용.

## 아키텍처

```
브라우저 ──/api 프록시──▶ server/advisor.ts (Bun)
  ├ Graph3D (three.js force-graph)     ├ Claude 에이전트 루프 (SSE 스트리밍)
  ├ HandTracker (MediaPipe)            │  ├ web_search / web_fetch   ← 선행연구 조사
  ├ FilterSidebar                      │  ├ search_venues            ← 베뉴 데이터 그라운딩
  └ AdvisorPanel ◀──── SSE ────────────│  ├ ask_user                 ← 객관식 질문 → UI 버튼
       │   (text/status/ask_user/graph)│  └ control_graph            ← 그래프 필터·포커스 (필수)
       └─▶ graphRef / filters          └ SQLite 대화 저장 (멀티유저 격리)

data/raw (CCF yml + CORE csv) ──build_venues.ts──▶ src/data/venues.json + relations.json
```

| 디렉토리 | 내용 |
|---|---|
| `src/data/` | 그래프 빌드·필터 순수 로직 (+테스트), 생성된 베뉴 데이터 |
| `src/components/` | Graph3D · HandTracker · FilterSidebar · DemoController · AdvisorPanel |
| `server/` | 어드바이저 백엔드 (API/Agent SDK 듀얼 드라이버, 베뉴 검색 툴) |
| `scripts/` | `build_venues.ts` (데이터 파이프라인) · `snapshot.ts` (시각 검증) |
| `docs/` | 데모 스크립트 · 로드맵 |

## 개발 방법론 — 루프 엔지니어링

이 프로젝트는 AI 에이전트가 스스로 검증·반복하는 루프 위에서 개발되었습니다.

- **정적**: `.ts/.tsx` 편집 직후 훅이 증분 타입체크(~0.7초) 실행, 실패 시 에러를
  에이전트 컨텍스트에 강제 피드백 (`.claude/hooks/post-edit-typecheck.ts`)
- **동적**: `bun test` — 그래프 빌드·필터·베뉴 검색 단위 테스트
- **지각**: `bun run snapshot` — headless Chrome으로 앱을 띄워 스크린샷을 AI가 직접
  보고 판단 (UI 깨짐은 테스트가 못 잡는다), uncaught error 시 non-zero exit
- **게이트**: `bun run verify` = typecheck → test → build → snapshot, 전부 green이어야 완료

보조 도구: [Graphify](https://github.com/safishamsi/graphify) 코드베이스 지식 그래프
(구조 질문 토큰 ~5배 절감 실측, `.mcp.json`으로 MCP 연동) · 검증 규칙은 `CLAUDE.md` 참고.

```bash
bun run verify        # 전체 검증 게이트
bun test              # 단위 테스트만
bun run snapshot      # 시각 검증만 (.loop/snapshot.png)
bun run build:venues  # data/raw → venues.json 재생성
```

## 스택

React 18 · Vite · three.js (react-force-graph-3d) · MediaPipe Tasks Vision ·
Bun (런타임/테스트/서버) · Anthropic SDK + Claude Agent SDK · SQLite (bun:sqlite) · playwright-core

## 로드맵

One-Euro Filter 손떨림 억제 → 제스처 다각화(Swipe/Lasso/Push) → Temporal/Semantic 뷰 →
WebXR. 상세: [docs/future_roadmap_ko.md](docs/future_roadmap_ko.md)
