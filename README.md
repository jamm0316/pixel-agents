# pixel-agents

Claude Code 세션의 서브에이전트들을 **도트 오피스**로 시각화하고, 도구 실행 권한을 브라우저 UI에서 승인할 수 있는 관찰/게이팅 도구.

- 메인 세션 + 서브에이전트들의 활동을 PixiJS 픽셀 캐릭터로 표시
- `PreToolUse` 훅으로 도구 실행을 가로채 브라우저에서 승인/거부
- 세션 + 도구별 "always-accept" 메모리, 안전 도구(Read/Grep/Glob/WebSearch/WebFetch/TodoWrite)는 자동 허용

> 본 도구는 **로컬 전용**입니다. `~/.claude/projects/<cwd>/<sessionId>.jsonl`을 직접 tail하기 때문에 본인 머신에서 실행해야 자기 Claude Code 세션을 관찰할 수 있습니다.

---

## 기술 스택

TypeScript / Node 18+ / React 18 / PixiJS v8 / Vite 5 / Hono 4 / chokidar 4

## 사전 준비

- **Node.js 18 이상**
- **Claude Code CLI** 설치 및 로그인 (세션 jsonl이 `~/.claude/projects/`에 생성되어야 함)

## 설치 & 실행

```bash
git clone https://github.com/jamm0316/pixel-agents.git
cd pixel-agents
npm install
npm run dev
```

- 백엔드: `http://localhost:7777`
- 프론트: `http://localhost:5173` (브라우저에서 열기)

개별 실행이 필요하면:

```bash
npm run dev:server   # Hono + SSE 서버만
npm run dev:web      # Vite 프론트만
```

## 권한 게이트(Hook) 연결

브라우저 UI에서 도구 승인을 받으려면, **본인이 Claude Code를 실행하는 프로젝트의** `.claude/settings.json`에 `hooks/permission-gate.mjs`를 `PreToolUse`로 등록해야 합니다.

대상 프로젝트의 `.claude/settings.json`에 다음을 추가:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"/absolute/path/to/pixel-agents/hooks/permission-gate.mjs\""
          }
        ]
      }
    ]
  }
}
```

> `/absolute/path/to/pixel-agents`는 본인이 클론한 위치로 바꾸세요. (예: `~/code/pixel-agents`)

서버가 다른 포트/호스트에 떠 있다면 환경변수로 지정:

```bash
PIXEL_AGENTS_SERVER=http://localhost:7777
```

서버가 꺼져 있어도 훅은 안전하게 `ask`로 폴백하므로 Claude Code 세션이 막히지 않습니다.

## 동작 방식

```
Claude Code 세션
  └─ ~/.claude/projects/<cwd>/<sessionId>.jsonl
  └─ ~/.claude/projects/<cwd>/subagents/agent-<aid>.jsonl
       ↓ chokidar tail + JSONL 증분 파서
  server/ (Hono + SSE :7777)
       ├─ GET  /stream                  SSE 스냅샷 + 이벤트
       ├─ GET  /api/sessions            현재 스냅샷
       ├─ GET  /api/pending             대기 중 권한 요청
       ├─ POST /api/permission-request  (hook → 서버)
       └─ POST /api/permission-response (UI → 서버)
       ↓ SSE
  src/ (React + PixiJS :5173)
       ├─ store.ts   StreamEvent → AppState 리듀서
       ├─ game/      PixiApp · Room · Character 상태머신
       └─ panel/     선택한 에이전트의 도구 히스토리
```

**유휴 타임아웃**: 메인 세션 5분, 서브에이전트 30초.

## 주요 명령어

```bash
npm run dev          # 백엔드 + 프론트 동시 실행
npm run build        # tsc -b && vite build
npm run preview      # 빌드 결과 미리보기
npx tsc --noEmit     # 타입체크
```

## 디렉터리

```
server/
  index.ts           Hono 앱 · SSE · 권한 API
  watcher.ts         chokidar tail + JSONL 파서
  agents-loader.ts   .claude/agents/*.md 로더
src/
  game/              PixiApp · 캐릭터 상태머신
  panel/             DetailPanel
hooks/
  permission-gate.mjs
```

## 트러블슈팅

- **브라우저에 아무것도 안 보임** → Claude Code 세션을 한 번이라도 시작해서 `~/.claude/projects/<cwd>/<sessionId>.jsonl`이 생성됐는지 확인
- **권한 팝업이 UI로 안 옴** → 대상 프로젝트의 `.claude/settings.json`에 훅이 등록됐는지, `permission-gate.mjs` 경로가 절대경로인지 확인
- **포트 충돌** → 7777/5173 사용 중인 프로세스를 종료하거나 vite/hono 설정에서 포트 변경

## 라이선스

MIT
