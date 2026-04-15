# pixel-agents

Claude Code 세션의 서브에이전트들을 도트 오피스로 시각화하고, 도구 실행 권한을 브라우저 UI에서 승인할 수 있는 관찰/게이팅 도구.

**기술 스택:** TypeScript / Node / React 18 / PixiJS v8 / Vite 5 / Hono 4 / chokidar 4

## 주요 명령어

```bash
# 개발 서버 (백엔드 :7777 + 프론트 :5173, concurrently)
npm run dev

# 개별 실행
npm run dev:server   # tsx watch server/index.ts
npm run dev:web      # vite

# 타입체크
npx tsc --noEmit

# 빌드 / 프리뷰
npm run build        # tsc -b && vite build
npm run preview
```

> 루트에 테스트 설정은 없음. 테스트는 `test-writer` 서브에이전트가 `node --test`로 작성/실행한다.

## 아키텍처

```
Claude Code 세션
  └─ ~/.claude/projects/<cwd>/<sessionId>.jsonl
  └─ ~/.claude/projects/<cwd>/subagents/agent-<aid>.jsonl (+ .meta.json)
       ↓ chokidar tail + JSONL 증분 파서 (server/watcher.ts)
  server/ (Hono + SSE :7777)
       ├─ GET  /stream               SSE: 스냅샷 + 이벤트 스트림
       ├─ GET  /api/sessions         현재 스냅샷
       ├─ GET  /api/ping              헬스체크
       ├─ GET  /api/pending          대기 중인 권한 요청 목록
       ├─ POST /api/permission-request  (hook → 서버)
       └─ POST /api/permission-response (UI → 서버)
       ↓ SSE
  src/ (React + PixiJS :5173, /api·/stream → :7777 프록시)
       ├─ store.ts       StreamEvent → AppState 리듀서
       ├─ game/          PixiApp: Room·Character·말풍선·상태머신
       │                 (idle / walking_to_desk / working / walking_home)
       └─ panel/         DetailPanel: 선택 에이전트 도구 히스토리
```

**유휴 타임아웃**: 메인 세션 ACTIVE_WINDOW 5분, 서브에이전트 유휴 30초.

## 권한 게이트 (PreToolUse 훅)

`.claude/settings.json`이 `hooks/permission-gate.mjs`를 `PreToolUse`로 등록한다.

- 안전 도구(Read/Grep/Glob/WebSearch/WebFetch)는 자동 허용
- 그 외 도구는 `/api/permission-request`로 POST 후 UI 응답 대기 (10분 타임아웃 → `ask` 폴백)
- 서버가 세션·도구별 "always-accept" 맵을 메모리에 유지
- 서버 미기동 시에도 훅이 `ask`로 폴백해 세션을 차단하지 않음

## 디렉터리

```
server/
  index.ts           Hono 앱 · SSE · 권한 API
  watcher.ts         chokidar tail + JSONL 파서 + 이벤트 브로드캐스트
  agents-loader.ts   .claude/agents/*.md 로더
  types.ts
src/
  main.tsx  App.tsx  store.ts  types.ts
  game/     PixiApp.ts · constants.ts · sprites.ts · korean.ts
  panel/    DetailPanel.tsx
hooks/
  permission-gate.mjs
.claude/
  settings.json
  agents/   plan-writer.md · implementer.md · test-writer.md · reviewer.md
```

## 워크플로우 (서브에이전트 파이프라인 — 필수)

> **메인 세션은 혼자 일하지 않는다.** 실제 코드 변경·조사·테스트·리뷰는 서브에이전트에게 위임하고, 메인은 오케스트레이션(요구사항 정리, 에이전트 호출 순서 결정, 결과 통합, 사용자 응답)만 담당한다. 메인이 직접 편집·빌드·디버깅을 수행하면 컨텍스트가 빠르게 차고 토큰을 낭비한다.

4단계 파이프라인:

1. **plan-writer (opus)** — 요구사항 + 현재 코드 조사 → `.claude/plans/<이름>/plan.md`
2. **implementer (sonnet)** — plan → 코드 변환 (파일 편집 수행)
3. **test-writer (sonnet)** — 단위 테스트 (`node --test`) 작성·실행
4. **reviewer (sonnet)** — PASS / FAIL 판정 + retry_target 지정

각 단계의 상세 규칙은 `.claude/agents/*.md` 참조. 단계 간 실패/재시도는 reviewer의 retry_target에 따라 분기한다.

**파이프라인을 쓰지 않아도 되는 예외는 다음만**:
- 1~2개 파일의 단순 수정으로 끝나는 게 명확한 경우 (typo, 상수 튜닝, 한 줄 버그 픽스)
- 단순 탐색/질문 응답 (읽기만 하는 조사)
- 위 예외라도 분량이 커질 조짐이 보이면 즉시 파이프라인으로 전환

**메인 세션이 금지하는 행동**:
- 다중 파일 리팩터를 직접 Edit/Write로 수행
- 대형 신규 기능 구현을 직접 수행
- 코드 조사/탐색을 Grep/Read로 직접 수행 — `Explore` 서브에이전트 사용
- "간단해 보이니 그냥 내가 하지" 판단으로 파이프라인 스킵

## 협업 방식

- **서브에이전트 우선** — 위 파이프라인 규칙을 반드시 따른다. 메인에서 직접 작업하는 유혹을 거부할 것
- 사용자 의견에 동조하지 않고 객관적 의견 제시 (trade-off, 제약사항, 대안 포함)
- 불명확한 요구사항은 추측하지 말고 먼저 질문
- 해결책은 가장 단순한 방식부터 시도
- 불가능한 시나리오에 대한 에러 핸들링 추가 금지
- 인접 코드 "개선" 금지 — 요청 범위만
