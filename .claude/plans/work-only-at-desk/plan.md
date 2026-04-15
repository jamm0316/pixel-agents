# 구현 계획: work-only-at-desk

## 배경 / 기대 동작

### 문제
사용자 피드백: "에이전트들이 작업을 할 때에는 컴퓨터 앞에서 일하도록 수정해줘. 지금은 꼭 컴퓨터 앞으로 가지 않더라도 작업을 하는 것 같아."

### 기대 동작
1. 서버로부터 `agent-start` / `agent-tool` 이벤트 수신 시, UI 상태는 **`walking_to_desk`** 로 먼저 들어간다 (기존: 곧바로 `working`).
2. `walking_to_desk` 동안에는 work 관련 시각 효과(말풍선 `sayTool` / `sayHandoff`, 모니터 타이핑 프레임 4~5, 랜덤 chatter 억제 등)를 **표시하지 않는다**. 대신 캐릭터는 책상 좌표로 걸어가고 걷기 프레임만 재생된다.
3. 책상 좌표에 **물리적으로 도달한 시점**에 상태가 `working`으로 전이되고, 그때부터 work 시각 효과가 ON 된다.
4. `agent-stop` 이벤트 수신 시 상태는 `walking_home`이 아니라 기존처럼 `idle`로 돌아간다(본 작업은 귀가 상태를 신규 도입하지 않음 — 범위 외).
5. 규칙은 오직 `work` 활동에만 적용된다. `meeting` / `pingpong` / `toilet` / `chatter` / `wander`의 시작/종료 흐름은 변경하지 않는다.

### 핵심 원칙
- **"working" ≠ "work 이벤트가 있다"**. `working`은 "책상 앞에 앉아있다"라는 물리적 상태를 의미해야 한다.
- 진행 중인 tool 정보(`currentTool`, `currentInputSummary`)는 `walking_to_desk` 동안에도 `AgentUiState`에 저장되어 있어야 한다 (DetailPanel이 기록/히스토리를 보여주므로). 다만 PixiApp의 말풍선 출력만 gate한다.

---

## 현재 코드 분석

### 1) 상태 타입 정의

- `src/types.ts:28`
  ```ts
  state: 'idle' | 'walking_to_desk' | 'working' | 'walking_home';
  ```
  UI 타입에는 4개 상태가 정의되어 있지만 **실제로 store에서 set되는 값은 `idle`과 `working` 두 개뿐**이다.

- `server/types.ts:17`
  ```ts
  state: 'idle' | 'working';
  ```
  서버 타입은 두 상태만 존재. 서버는 본 작업에서 수정하지 않는다.

### 2) store가 상태를 전이시키는 지점

- `src/store.ts:82-87` — `agent-start`
  ```ts
  case 'agent-start': {
    const a = ensureAgent(state, evt.sessionId, evt.agentName);
    a.state = 'working';
    a.lastEventAt = evt.timestamp;
    break;
  }
  ```
  곧바로 `working`으로 set — 책상 이동을 거치지 않음.

- `src/store.ts:88-103` — `agent-tool`
  ```ts
  case 'agent-tool': {
    const a = ensureAgent(state, evt.sessionId, evt.agentName);
    a.state = 'working';
    a.currentTool = evt.tool;
    a.currentInputSummary = evt.inputSummary;
    ...
  }
  ```
  마찬가지. 여기에 `currentTool`도 세팅된다.

- `src/store.ts:122-128` — `agent-stop` → `idle`.

**버그의 근본 원인(a/b)**: 이 지점에서 `walking_to_desk`를 거치지 않고 곧바로 `working`을 write하기 때문에, PixiApp는 사실상 `walking_to_desk`를 절대 본 적이 없다.

### 3) PixiApp가 상태를 읽어 Character에 반영하는 지점

- `src/game/PixiApp.ts:1962-1988`
  ```ts
  const prevState = ch.state;
  ch.state = ag.state;  // ← store 상태를 Character로 직결 복사

  const becomingWorking = ag.state === 'working' || ag.state === 'walking_to_desk';
  const wasWorking = prevState === 'working' || prevState === 'walking_to_desk';

  if (!isNew && prevState !== ag.state) {
    if (becomingWorking && !wasWorking) {
      // Enter work: claim the activity slot...
      ch.onActivityPreempt = undefined;
      ch.tryStartActivity('work');
      const t = deskFor(room, agentName);
      ch.walkPath([room.approachInterior, t]);
    } else if (!becomingWorking && wasWorking) {
      ch.endActivity('work');
      ch.pickWanderTarget();
    } else if (!becomingWorking) {
      ch.pickWanderTarget();
    }
  } else if (isNew && becomingWorking) {
    ch.tryStartActivity('work');
    const t = deskFor(room, agentName);
    ch.walkPath([room.approachInterior, t]);
  }
  ```
  - 방어적으로 `walking_to_desk`도 체크하고 있으나, 현실에서는 store가 이 값을 보내지 않으므로 데드 코드.
  - `ch.state = ag.state` 한 줄로 `Character.state`가 직접 `'working'`이 되며, 이 시점에 아직 캐릭터는 `room.approachInterior`에서 책상으로 막 걸어가기 시작한 상태다.

### 4) 말풍선/애니메이션이 `state === 'working'`에 의존하는 지점

- `src/game/PixiApp.ts:1999-2006`
  ```ts
  if (ag.state === 'working' && ag.currentTool) {
    const summary = ag.currentInputSummary ?? '';
    if (ag.currentTool === 'Task' || ag.currentTool === 'Agent') {
      ch.sayHandoff(parseHandoffTarget(summary), summary);
    } else {
      ch.sayTool(ag.currentTool, summary);
    }
  }
  ```
  `ag.state === 'working'`면 곧바로 말풍선 호출. 현재 store는 tool 이벤트 수신 즉시 `working`으로 set하므로, **이동 중에도 말풍선이 뜬다**. 이것이 버그의 시각적 증상 (원인 b+c).

- `src/game/PixiApp.ts:771-773`
  ```ts
  } else if (this.state === 'working') {
    this.walkCounter += dt * 8;
    newFrame = 4 + (Math.floor(this.walkCounter) % 2);
  }
  ```
  `Character.state === 'working'`이면 타이핑(프레임 4/5)을 재생. 그러나 이 분기는 `walking`이 false일 때만 도달하므로 실제 이동 중에는 걷기 프레임이 먼저 잡힌다. 그럼에도 `ch.state === 'working'`이 이미 set되어 있으므로 도착 직후에 즉시 타이핑 프레임으로 전환된다 (기능상은 기존과 동일하지만 상태 의미 맞춤을 위해 동일하게 유지).

- `src/game/PixiApp.ts:698, 751` — wander / chatter 게이트가 `this.state === 'idle'`만 허용. `walking_to_desk`는 idle이 아니므로 wander/chatter는 자연스럽게 억제된다. ✔

### 5) 책상 도달 판정 로직

- 현재 별도의 "desk arrived" 판정은 **없다**.
- `walkPath(points, onComplete)`이 최종 waypoint에 도달하면 `pathOnComplete` 콜백을 호출한다 — `src/game/PixiApp.ts:686-691`.
  ```ts
  } else if (this.path.length > 0) {
    const next = this.path.shift()!;
    ...
  } else if (this.pathOnComplete) {
    const cb = this.pathOnComplete;
    this.pathOnComplete = undefined;
    cb();
  }
  ```
- 즉, `walkPath([approachInterior, deskTarget], onComplete)`에 콜백을 넘기면 **deskTarget에 도달했을 때 자동으로 콜백이 불린다**. 새로운 거리 임계값 로직은 필요 없다.

### 6) `Character.state` 덮어쓰기 순서 주의

- `src/game/PixiApp.ts:1963`에서 `ch.state = ag.state`로 **매 sync마다** store 상태를 Character에 덮어쓴다. 본 작업에서는 store가 `walking_to_desk`를 보내므로, sync가 반복되어도 Character가 `walking_to_desk`를 유지한다. 책상 도달 시 Character 쪽에서 자체적으로 `working`으로 승격시키더라도, 다음 sync가 들어오면 store의 `walking_to_desk`로 다시 덮어써버리는 회귀가 생길 수 있다 → **store에서 "도착 이벤트"를 받아 `working`으로 전이**시키는 구조가 필요하다.

### 7) `activity.test.ts` 영향

- 현재 `activity.test.ts`는 `ACTIVITY_PRIORITY`, `ActivitySlot`, `BathroomManager`만 테스트한다. `work`/`walking_to_desk`의 시점 문제는 테스트 범위 밖이다.
- `store.ts`의 리듀서는 현재 테스트가 없다. 본 작업의 변경은 주로 store에 집중되므로 **신규 테스트 파일 `src/store.test.ts`** 를 만드는 편이 자연스럽다.

---

## 변경 계획

변경은 다음 3개 파일에 한정한다.

### A. `src/store.ts`

#### 목적
`agent-start` / `agent-tool` 이벤트를 받을 때 **곧바로 `working`으로 들어가지 않고**, 현재 상태가 `walking_to_desk`가 아니고 `working`이 아닌 경우에만 `walking_to_desk`로 전이한다. 이후 UI(PixiApp)가 "책상 도달"을 알리는 새 이벤트로 store를 `working`으로 승격시킨다.

또한 신규 UI 전용 이벤트 `agent-arrived-at-desk`를 StreamEvent union에 추가한다 (서버는 모르는 클라이언트 내부 이벤트 — `kind` 이름에 주의).

#### A-1. `src/types.ts` (타입 확장)

old (`src/types.ts:44-53`):
```ts
export type StreamEvent =
  | { kind: 'snapshot'; sessions: SessionInfo[]; pending: PermissionRequest[] }
  | { kind: 'session-open'; session: SessionInfo }
  | { kind: 'session-close'; sessionId: string }
  | { kind: 'agent-start'; sessionId: string; agentName: string; tool: string; inputSummary: string; toolCallId: string; timestamp: number }
  | { kind: 'agent-tool'; sessionId: string; agentName: string; tool: string; inputSummary: string; toolCallId: string; timestamp: number }
  | { kind: 'agent-tool-end'; sessionId: string; agentName: string; toolCallId: string; status: 'done' | 'error'; timestamp: number }
  | { kind: 'agent-stop'; sessionId: string; agentName: string; timestamp: number }
  | { kind: 'permission-request'; req: PermissionRequest }
  | { kind: 'permission-resolved'; requestId: string; decision: 'allow' | 'deny' };
```

new: **동일 union에 한 줄 추가**. UI 전용이므로 주석으로 명시한다.
```ts
export type StreamEvent =
  | { kind: 'snapshot'; sessions: SessionInfo[]; pending: PermissionRequest[] }
  | { kind: 'session-open'; session: SessionInfo }
  | { kind: 'session-close'; sessionId: string }
  | { kind: 'agent-start'; sessionId: string; agentName: string; tool: string; inputSummary: string; toolCallId: string; timestamp: number }
  | { kind: 'agent-tool'; sessionId: string; agentName: string; tool: string; inputSummary: string; toolCallId: string; timestamp: number }
  | { kind: 'agent-tool-end'; sessionId: string; agentName: string; toolCallId: string; status: 'done' | 'error'; timestamp: number }
  | { kind: 'agent-stop'; sessionId: string; agentName: string; timestamp: number }
  | { kind: 'permission-request'; req: PermissionRequest }
  | { kind: 'permission-resolved'; requestId: string; decision: 'allow' | 'deny' }
  // UI-only event: dispatched by PixiApp when the character physically reaches its desk.
  // Never produced by the server; promotes walking_to_desk -> working.
  | { kind: 'agent-arrived-at-desk'; sessionId: string; agentName: string; timestamp: number };
```

#### A-2. `src/store.ts` — `agent-start` 케이스

old (`src/store.ts:82-87`):
```ts
case 'agent-start': {
  const a = ensureAgent(state, evt.sessionId, evt.agentName);
  a.state = 'working';
  a.lastEventAt = evt.timestamp;
  break;
}
```

new:
```ts
case 'agent-start': {
  const a = ensureAgent(state, evt.sessionId, evt.agentName);
  // Only enter walking_to_desk if we're not already seated or en route.
  if (a.state !== 'working' && a.state !== 'walking_to_desk') {
    a.state = 'walking_to_desk';
  }
  a.lastEventAt = evt.timestamp;
  break;
}
```

#### A-3. `src/store.ts` — `agent-tool` 케이스

old (`src/store.ts:88-103`):
```ts
case 'agent-tool': {
  const a = ensureAgent(state, evt.sessionId, evt.agentName);
  a.state = 'working';
  a.currentTool = evt.tool;
  a.currentInputSummary = evt.inputSummary;
  a.lastEventAt = evt.timestamp;
  const tc: ToolCall = {
    id: evt.toolCallId,
    tool: evt.tool,
    inputSummary: evt.inputSummary,
    startedAt: evt.timestamp,
    status: 'running',
  };
  a.history = [...a.history.slice(-49), tc];
  break;
}
```

new:
```ts
case 'agent-tool': {
  const a = ensureAgent(state, evt.sessionId, evt.agentName);
  // If the agent is already seated (working), stay working.
  // Otherwise route them to the desk first.
  if (a.state !== 'working' && a.state !== 'walking_to_desk') {
    a.state = 'walking_to_desk';
  }
  a.currentTool = evt.tool;
  a.currentInputSummary = evt.inputSummary;
  a.lastEventAt = evt.timestamp;
  const tc: ToolCall = {
    id: evt.toolCallId,
    tool: evt.tool,
    inputSummary: evt.inputSummary,
    startedAt: evt.timestamp,
    status: 'running',
  };
  a.history = [...a.history.slice(-49), tc];
  break;
}
```

**의도**: `currentTool` / `history`는 즉시 기록 (DetailPanel이 기록 시점에 의존). 상태만 책상 이동 단계로 잡아 UI 시각 효과를 지연시킨다.

#### A-4. `src/store.ts` — 신규 `agent-arrived-at-desk` 케이스

`agent-stop` 케이스 바로 위(또는 아래) 어디든 좋다. 순서 권장: `agent-tool-end` 다음.

insert after `src/store.ts:121` (close brace of `agent-tool-end`):
```ts
case 'agent-arrived-at-desk': {
  const a = ensureAgent(state, evt.sessionId, evt.agentName);
  // Only promote if still en route. If agent-stop raced ahead and set idle,
  // do not resurrect a working state.
  if (a.state === 'walking_to_desk') {
    a.state = 'working';
  }
  a.lastEventAt = evt.timestamp;
  break;
}
```

#### A-5. `src/store.ts` — `agent-stop` 케이스는 변경 없음
`agent-stop`은 여전히 `a.state = 'idle'`로 set. 책상 도달 전에 `agent-stop`이 들어오면 `walking_to_desk` → `idle`이 되고, PixiApp는 자연스럽게 work 활동을 끝낸다(아래 B-3 참조).

---

### B. `src/game/PixiApp.ts`

#### 목적
1. `ch.state`를 store의 `ag.state`로 덮어쓸 때, `walking_to_desk`와 `working`을 모두 정확히 반영한다.
2. `walking_to_desk`로 전이될 때 `walkPath`에 콜백을 넘겨, 책상 도달 시 store에 `agent-arrived-at-desk` 이벤트를 발송한다.
3. 말풍선(`sayTool` / `sayHandoff`) 게이트를 `ag.state === 'working'`으로 유지 — 즉, `walking_to_desk` 동안에는 tool 말풍선이 뜨지 않도록 보장한다 (이미 그런 구조이지만 store 변경 후 자동으로 올바르게 동작).
4. `agent-stop` 등으로 `walking_to_desk` → `idle`로 역전이할 때, 책상 도착 콜백이 잔존해 말풍선이 뜨는 일을 방지한다.

#### B-1. sync 블록에서 store로 arrived 이벤트를 발송하는 수단 도입

PixiApp 팩토리는 `sync`에 store의 `applyEvent`를 직접 부를 수단이 없다. 현재 구조에서는 `sync`의 인자로 들어오는 `agents: Map<...>`만 사용한다.

방법: PixiApp 팩토리에 **옵션 콜백 `onAgentArrivedAtDesk?(sessionId, agentName)`** 을 추가한다. `src/App.tsx`(또는 PixiApp을 생성하는 지점)에서 이 콜백을 store dispatch에 연결한다.

**구체 위치**: `src/game/PixiApp.ts`의 팩토리 함수 파라미터 / 반환 객체를 확장한다. 기존 구조를 먼저 확인해야 한다.

implementer 작업 순서:
1. `src/game/PixiApp.ts`에서 팩토리 함수(파일 상단~중반에 `export function createPixiApp(...)` 형태로 존재할 가능성) 시그니처를 찾는다. 본 plan 작성 시점에는 세부 위치를 확정하지 않았으므로, implementer는 `createPixiApp` 또는 `mountPixi` 같은 키워드로 탐색한 뒤, **기존 콜백 등록 패턴(`onSelect`, `onPermissionChoice`)과 동일한 방식**으로 `onAgentArrivedAtDesk` 콜백 슬롯을 추가한다.
2. 구체적으로 `selectListeners`, `permissionListeners`와 나란히 `arrivedListeners: Set<(sessionId: string, agentName: string) => void>`를 둔다. 반환 객체에 `onAgentArrivedAtDesk(fn)` 메서드를 추가 — `src/game/PixiApp.ts:2038-2043`의 `onSelect` / `onPermissionChoice` 패턴 그대로 복사.
3. `notifyArrivedAtDesk(sessionId, agentName)` 헬퍼 함수를 `notifySelect` / `notifyPermission` 옆에 정의 (현재 파일에 이 두 함수가 있다. implementer는 Grep으로 찾아 같은 스타일로 추가).

#### B-2. sync의 state transition 블록 수정

old (`src/game/PixiApp.ts:1962-1988`):
```ts
const prevState = ch.state;
ch.state = ag.state;

const becomingWorking = ag.state === 'working' || ag.state === 'walking_to_desk';
const wasWorking = prevState === 'working' || prevState === 'walking_to_desk';

if (!isNew && prevState !== ag.state) {
  if (becomingWorking && !wasWorking) {
    // Enter work: claim the activity slot. work has the highest priority,
    // so this always succeeds and preempts whatever was running.
    ch.onActivityPreempt = undefined; // work itself never gets preempted
    ch.tryStartActivity('work');
    const t = deskFor(room, agentName);
    ch.walkPath([room.approachInterior, t]);
  } else if (!becomingWorking && wasWorking) {
    // Leave work: release the slot and resume autonomous behavior.
    ch.endActivity('work');
    ch.pickWanderTarget();
  } else if (!becomingWorking) {
    // Other transitions that aren't work-related (rare).
    ch.pickWanderTarget();
  }
} else if (isNew && becomingWorking) {
  ch.tryStartActivity('work');
  const t = deskFor(room, agentName);
  ch.walkPath([room.approachInterior, t]);
}
```

new:
```ts
const prevState = ch.state;
ch.state = ag.state;

const becomingWorking = ag.state === 'working' || ag.state === 'walking_to_desk';
const wasWorking = prevState === 'working' || prevState === 'walking_to_desk';

// Walk a character to its desk, claiming the work activity slot.
// On physical arrival, notify the store so it can promote walking_to_desk -> working.
const routeToDesk = () => {
  ch!.onActivityPreempt = undefined; // work itself never gets preempted
  ch!.tryStartActivity('work');
  const t = deskFor(room, agentName);
  ch!.walkPath([room.approachInterior, t], () => {
    // Only notify if we're still en route. If agent-stop raced ahead and
    // flipped state to idle, do not fire the desk-arrival event.
    if (ch!.state === 'walking_to_desk') {
      notifyArrivedAtDesk(sid, agentName);
    }
  });
};

if (!isNew && prevState !== ag.state) {
  if (becomingWorking && !wasWorking) {
    // Enter work: start walking to desk.
    routeToDesk();
  } else if (!becomingWorking && wasWorking) {
    // Leave work (including mid-walk stop): release the slot and resume autonomous behavior.
    ch.endActivity('work');
    ch.pickWanderTarget();
  } else if (!becomingWorking) {
    // Other transitions that aren't work-related (rare).
    ch.pickWanderTarget();
  }
  // If becomingWorking && wasWorking (e.g., walking_to_desk -> working promotion),
  // do nothing here — the character is already on its way or seated.
} else if (isNew && becomingWorking) {
  routeToDesk();
}
```

**핵심 변화**:
- `routeToDesk` 헬퍼로 "책상으로 걷기 시작 + 도착 시 알림" 로직을 묶는다.
- `walking_to_desk → working` 전이(둘 다 `becomingWorking === true`)에서는 `prevState !== ag.state`이지만 `!wasWorking && becomingWorking`이 false다. 현재의 if-else 연쇄에서는 `!becomingWorking`만 확인하므로 이 경우에는 어떤 분기에도 들어가지 않아 **경로/활동 슬롯을 건드리지 않는다** — 이는 의도된 동작이며 주석으로 명시한다.
- `walking_to_desk → idle` 전이: `!becomingWorking && wasWorking` 분기에 진입해 `endActivity('work')` 호출. 캐릭터는 wander로 복귀. 이미 walkPath 중이면 `pickWanderTarget`이 `walkTo`로 덮어써 기존 경로를 취소한다 (`src/game/PixiApp.ts:243-250` `walkTo` 초기화 로직 참조).
- **중요 가드**: 도착 콜백 내부에서 `ch.state === 'walking_to_desk'`를 재확인하여, 도착 시점에 agent-stop이 먼저 와 있었다면 이벤트를 발송하지 않는다 (store에서 한 번 더 가드하지만 이중 안전장치).

#### B-3. 말풍선 게이트는 변경 없음

`src/game/PixiApp.ts:1999-2006`의 `if (ag.state === 'working' && ag.currentTool)`는 **그대로 둔다**. store가 이제 `walking_to_desk`를 유지하므로, 이 조건은 자동으로 false가 되어 이동 중 말풍선이 뜨지 않는다. 책상 도달 → `agent-arrived-at-desk` → store `working` → 다음 sync → 말풍선 출현, 이 흐름으로 동작한다.

#### B-4. `Character.state === 'working'` 타이핑 프레임 — 변경 없음
`src/game/PixiApp.ts:771-773`의 타이핑 애니메이션 분기는 그대로 둔다. `ch.state`는 `ag.state`를 그대로 반영하므로, `walking_to_desk` 동안에는 이 분기에 진입하지 않고 (그리고 어차피 walking이 true라 무관) 도착 후에만 타이핑 프레임이 재생된다.

---

### C. `src/App.tsx` (또는 PixiApp을 생성하는 호출부)

#### 목적
새 콜백 `onAgentArrivedAtDesk`를 store dispatch에 연결한다.

implementer 작업:
1. `src/App.tsx`에서 기존에 `pixi.onSelect(...)` / `pixi.onPermissionChoice(...)` 같은 호출을 Grep으로 찾는다.
2. 동일 블록 바로 아래에 다음 코드를 추가한다.
   ```ts
   pixi.onAgentArrivedAtDesk((sessionId, agentName) => {
     dispatch({
       kind: 'agent-arrived-at-desk',
       sessionId,
       agentName,
       timestamp: Date.now(),
     });
   });
   ```
   - `dispatch`는 기존 store 사용 패턴을 그대로 따른다. `applyEvent`를 직접 부르는 방식이면 그 패턴을 복사한다.
   - implementer는 `src/App.tsx` / `src/main.tsx` / `src/store.ts` 호출부를 확인 후 적절한 호출 함수명을 쓴다.

---

## 테스트 계획 (test-writer가 작성할 케이스)

신규 파일: `src/store.test.ts` (`node --test` + `tsx`)

루트에 `activity.test.ts`가 이미 `node:test` + `tsx`로 실행되고 있으므로 동일 패턴 사용.

### 1. `store / walking_to_desk transition on agent-start`
- 초기 상태 `idle`인 에이전트에 `agent-start` 이벤트를 적용한다.
- 결과: `a.state === 'walking_to_desk'`이어야 한다 (기존 구현이었다면 `working`이 되었을 것).

### 2. `store / walking_to_desk transition on agent-tool`
- 초기 상태 `idle`에 `agent-tool` 이벤트 적용.
- 결과:
  - `a.state === 'walking_to_desk'`
  - `a.currentTool === evt.tool`
  - `a.currentInputSummary === evt.inputSummary`
  - `a.history`에 running ToolCall이 추가되어 있어야 한다.

### 3. `store / agent-tool while already working stays working`
- 초기 상태를 `working`으로 세팅 (e.g., 이전 이벤트 리플레이).
- `agent-tool` 이벤트 적용.
- 결과: `a.state === 'working'` (이동 중인 것으로 되돌아가지 않아야 한다).

### 4. `store / agent-tool while walking_to_desk stays walking_to_desk`
- 초기 상태 `walking_to_desk`.
- 추가 `agent-tool` 이벤트 적용.
- 결과: 상태는 그대로 `walking_to_desk`. `currentTool`만 갱신.

### 5. `store / agent-arrived-at-desk promotes walking_to_desk to working`
- 초기 상태 `walking_to_desk`.
- `agent-arrived-at-desk` 이벤트 적용.
- 결과: `a.state === 'working'`.

### 6. `store / agent-arrived-at-desk is ignored when not walking_to_desk`
- 초기 상태 `idle`에 `agent-arrived-at-desk` 적용 → 상태 `idle` 유지.
- 초기 상태 `working`에 `agent-arrived-at-desk` 적용 → 상태 `working` 유지.

### 7. `store / agent-stop resets walking_to_desk to idle`
- 초기 상태 `walking_to_desk`에 `agent-stop` 적용.
- 결과: `a.state === 'idle'`, `currentTool === undefined`.

### 8. `store / race: agent-arrived-at-desk after agent-stop stays idle`
- `walking_to_desk` → `agent-stop` → `idle` → `agent-arrived-at-desk` 순서.
- 결과: `a.state === 'idle'` (부활 금지 가드 검증).

### 9. (선택) `activity.test.ts`는 변경하지 않는다
- `ActivitySlot` / `BathroomManager` / `ACTIVITY_PRIORITY`는 의미가 바뀌지 않으므로 기존 테스트 유지.

### PixiApp 통합 테스트
PixiApp는 pixi.js DOM 의존이 있어 node:test로 직접 검증할 수 없다. 본 작업은 store 단위로 충분히 검증 가능하므로 PixiApp 통합 테스트는 추가하지 않는다 (reviewer에게 이 결정을 plan에 적시한다).

---

## 영향 범위 / 리스크

### 영향 범위
- `src/types.ts` — StreamEvent union에 한 줄 추가 (하위 호환 O, 기존 handler는 영향 없음).
- `src/store.ts` — `agent-start` / `agent-tool` / 신규 `agent-arrived-at-desk` 케이스 수정/추가.
- `src/game/PixiApp.ts` — 팩토리 반환 객체에 `onAgentArrivedAtDesk` 등록 API 추가, sync 블록 state 전이 로직 리팩터.
- `src/App.tsx` — dispatch 연결 한 줄 추가.
- `src/store.test.ts` — 신규 테스트 파일.

### 범위 외 (하지 않는 것)
- 서버(`server/`) 수정 — `server/types.ts`의 상태 타입은 건드리지 않는다. 서버는 여전히 `idle|working`만 알며, UI에서 `walking_to_desk`는 클라이언트 내부 상태로만 존재.
- `walking_home` 상태 도입 — 사용자 요구는 "작업 시 책상에 있을 것"만이므로 귀가 애니메이션은 범위 외. 기존처럼 `agent-stop` 후 `idle`로 돌아가며 wander 재개.
- `Character.state === 'working'` 타이핑 프레임 로직 변경 금지.
- `DetailPanel` 변경 금지. `currentTool` / `history`는 `walking_to_desk` 동안에도 기록되므로 기존 UI가 그대로 동작.
- `meeting` / `pingpong` / `toilet` 관련 경로 변경 금지. 이들은 `ACTIVITY_PRIORITY`와 기존 매니저로 그대로 동작.

### 리스크 & 완화
1. **레이스 조건**: `walking_to_desk` 중 `agent-stop`이 도착 → `walkPath` 콜백이 아직 남아 있음.
   - 완화: Character 쪽에서 `endActivity('work')` + `pickWanderTarget()` 시 `walkTo`가 호출되어 `path`가 비워지고 `pathOnComplete`가 `undefined`로 리셋됨 (`src/game/PixiApp.ts:243-250`). 추가로 도착 콜백 내부에서 `ch.state === 'walking_to_desk'` 가드를 한 번 더 둔다. store 쪽에도 `agent-arrived-at-desk` 가드가 있으므로 삼중 안전장치.

2. **도착 전 연속 tool 이벤트**: `walking_to_desk` 중에 두 번째 `agent-tool`이 들어와 `currentTool`이 바뀌면, 도착 후 최신 tool로 말풍선이 뜬다.
   - 이는 기대 동작. 기존에는 두 이벤트 모두 즉시 말풍선으로 튀었으나 이제는 최신 것만 도착 시에 한 번 뜬다. 사용자 요구("책상 앞에서만 표시")와 일치.

3. **탁구/회의 중 tool 이벤트**: 캐릭터가 탁구 중인데 tool 이벤트가 들어오면 store가 `walking_to_desk`로 전환 → 다음 sync에서 PixiApp가 `routeToDesk` 호출 → `tryStartActivity('work')`가 탁구를 preempt.
   - 기존 동작과 동일 (`work`가 최고 우선순위). 유일한 차이는 `working` 시각 효과가 책상 도달 시에만 나타난다는 점. 이는 요구사항에 부합.

4. **snapshot 이벤트**: 초기 snapshot에는 agent 상태가 포함되지 않는다 (`applyEvent` snapshot 케이스는 session만 복원한다). 새로 join하는 클라이언트가 스냅샷 시점에 `working` 상태인 에이전트를 못 볼 위험 — 본 플랜에서는 이 시나리오도 다루지 않는다. 기존과 동일하게 다음 `agent-tool` 이벤트가 와야 상태가 갱신된다. **범위 외**.

5. **메인 세션 vs 서브에이전트 분기**: Character 상태 머신은 이름으로 구분되지 않고 (`agents` Map이 `sessionId:agentName` 키) 동일한 Character 클래스/sync 로직을 쓴다. 따라서 메인과 서브에이전트 모두 동일한 규칙이 적용됨 — 요구사항과 일치.

---

## Task 순서

**Step 1 (순차 필수)**:
- Task A-1 (`src/types.ts`에 StreamEvent 확장) — 타입이 먼저 있어야 store/PixiApp가 이 이벤트를 사용할 수 있음.

**Step 2 (병렬 가능)**:
- Task A-2/A-3/A-4/A-5 (`src/store.ts` 수정)
- Task B-1/B-2 (`src/game/PixiApp.ts` 수정)
- Task C (`src/App.tsx` dispatch 연결)

**Step 3**:
- Task 테스트 (`src/store.test.ts` 신규) — test-writer 담당, 위 7~8 케이스.

**Step 4**:
- Reviewer가 `npm run dev`로 수동 스모크 확인은 불가 (브라우저 필요). 대신 `npx tsc --noEmit` + `node --test`로 판정한다.
