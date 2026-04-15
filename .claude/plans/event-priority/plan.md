# 구현 계획: 이벤트 우선순위 시스템 (event-priority)

## 접근 방식

현재 코드는 활동(meeting / pingpong / bathroom / wander / chatter)이 각자 독립 플래그(`inMeeting`, `inPingPong`, `inBathroom`)와 매니저에서 산발적으로 게이트된다. 우선순위 비교 로직이 없고, "탁구 진행 중에는 화장실 금지"같은 규칙은 `tick()`의 if 체인에 흩어져 있다.

이 계획은 `Character`에 **단일 활동 슬롯**(`currentActivity: ActivityKind | null`)과 **우선순위 비교 헬퍼**(`tryStartActivity` / `endActivity`)를 도입한다. 모든 활동(work / pingpong / toilet / chatter / wander)은 시작 전 `tryStartActivity(kind)`를 호출해 우선순위 비교를 통과해야 한다. 상위 활동은 하위를 선점(preempt)하고, 그 과정에서 매니저(PingPongManager / MeetingManager)는 자기 이벤트를 정리(`abort`)한다.

work는 외부 SSE 이벤트로만 시작/종료되므로, `sync()`에서 `agent.state` 전이를 감지해 `tryStartActivity('work')` / `endActivity('work')`를 호출한다. 다른 활동은 모두 자율 트리거(타이머)다.

핵심 규칙:
- 우선순위(높음→낮음): `work=4` > `pingpong=3` > `toilet=2` > `chatter=1` > `wander=0`
- `tryStartActivity(new)`: `currentActivity === null`이거나 `priority(new) > priority(currentActivity)`이면 성공. 동등(`==`) 또는 하위는 실패(무시).
- 성공 시 기존 활동이 있으면 `preempt`로 종료(매니저에 전파해 ball/meeting 정리, 캐릭터를 home으로 복귀시킬지 여부는 활동별 로직에 위임).
- work는 최우선 — 어떤 활동이 진행 중이든 항상 선점.

---

## 영향받는 레이어

- `src/game/PixiApp.ts` 단일 파일 (Character / PingPongManager / MeetingManager / sync)
- `src/store.ts`, `server/`, `src/types.ts` — **변경 없음** (SSE 스키마 그대로)

---

## Task 목록

### Task 1: ActivityKind 타입과 우선순위 테이블 정의

#### 대상 파일
- `src/game/PixiApp.ts` (기존, 상단 타입 정의 영역 — 현재 53~57 라인 부근)

#### 추가할 타입/상수

```ts
type ActivityKind = 'work' | 'pingpong' | 'toilet' | 'chatter' | 'wander';

const ACTIVITY_PRIORITY: Record<ActivityKind, number> = {
  work: 4,
  pingpong: 3,
  toilet: 2,
  chatter: 1,
  wander: 0,
};
```

추가 위치: `type PermissionChoice = ...` 바로 다음 줄 (현재 57 라인 직후).

#### 성공 기준
- `npx tsc --noEmit` 통과
- 두 심볼이 모듈 내부에서 export되지 않고 파일 내부에서만 사용 가능

---

### Task 2: Character에 활동 슬롯과 우선순위 헬퍼 도입

#### 대상 파일
- `src/game/PixiApp.ts` (기존, `class Character` — 현재 102~664 라인)

#### 추가 필드 (Character 클래스 멤버, 현재 `inBathroom = false;` 라인 153 부근에 추가)

```ts
// Activity slot — single source of truth for what the character is doing.
// Replaces direct mutation of inMeeting / inPingPong / inBathroom from outside.
currentActivity: ActivityKind | null = null;

// Hook called when a higher-priority activity preempts the current one.
// Set by whoever started the activity (manager or character itself).
onActivityPreempt: ((preemptedBy: ActivityKind) => void) | undefined;
```

**중요:** 기존 `inMeeting`, `inPingPong`, `inBathroom` 플래그는 **삭제하지 않는다**. 시각 효과(예: `tick()`에서 `inPingPong` 시 swing arms 애니메이션, 567~570 라인의 wander 억제)에 직접 사용되고 있어 호환성 위해 유지하되, **`currentActivity`가 단일 진실 공급원**이고 `inXxx` 플래그는 그 미러일 뿐이다. 미러는 `tryStartActivity` / `endActivity` 내부에서만 갱신한다.

#### 추가 메서드 (Character 클래스, `setSelected` 직전 514 라인 부근에 추가)

```ts
/**
 * Try to start a new activity. Returns true if accepted.
 *
 * Rules:
 *   - If no current activity, always accept.
 *   - If current activity has STRICTLY LOWER priority, preempt it
 *     (call onActivityPreempt with the new kind, then null it out)
 *     and accept the new activity.
 *   - Otherwise (equal or higher priority already running), reject.
 *
 * Caller is responsible for setting onActivityPreempt BEFORE the
 * activity actually changes state (so preempt cleanup can run).
 */
tryStartActivity(kind: ActivityKind): boolean {
  if (this.currentActivity !== null) {
    const cur = ACTIVITY_PRIORITY[this.currentActivity];
    const next = ACTIVITY_PRIORITY[kind];
    if (next <= cur) return false;
    // Preempt the current activity
    const preemptCb = this.onActivityPreempt;
    const preempted = this.currentActivity;
    this.onActivityPreempt = undefined;
    this.currentActivity = null;
    this.syncActivityMirrors(null);
    preemptCb?.(kind);
    // Note: after preemptCb runs, mirrors and currentActivity stay null
    // until we set them below for the new activity.
    void preempted;
  }
  this.currentActivity = kind;
  this.syncActivityMirrors(kind);
  return true;
}

/**
 * End the currently-running activity if it matches `kind`.
 * No-op if a different (or no) activity is current — this guards
 * against late callbacks from preempted activities.
 */
endActivity(kind: ActivityKind): void {
  if (this.currentActivity !== kind) return;
  this.currentActivity = null;
  this.onActivityPreempt = undefined;
  this.syncActivityMirrors(null);
}

/**
 * Keep legacy in* flags in sync with currentActivity so that existing
 * tick() animation/wander gates keep working.
 */
private syncActivityMirrors(kind: ActivityKind | null): void {
  this.inMeeting = false;       // meeting is not in the new system yet — see Task 6
  this.inPingPong = kind === 'pingpong';
  this.inBathroom = kind === 'toilet';
}
```

**주의:** `syncActivityMirrors`에서 `inMeeting`은 항상 false로 두지 않는다. Meeting은 Task 6에서 별도 처리한다. 임시 안전판으로 `syncActivityMirrors`는 **`inMeeting`을 건드리지 않는다.** 위 코드의 `this.inMeeting = false;` 줄은 삭제하고, MeetingManager가 직접 `inMeeting`을 set/clear한다 (Task 6에서 활동 시스템에 통합).

#### 성공 기준
- `tryStartActivity('work')`가 `currentActivity='pingpong'` 상태에서 호출되면 true 반환, `onActivityPreempt`가 `'work'` 인자로 호출되고 `currentActivity='work'`가 된다.
- `tryStartActivity('toilet')`이 `currentActivity='pingpong'` 상태에서 호출되면 false 반환, `currentActivity='pingpong'` 유지.
- `endActivity('toilet')`이 `currentActivity='pingpong'`일 때 호출되면 no-op.
- `tsc --noEmit` 통과.

---

### Task 3: PingPongManager가 활동 시스템을 사용하도록 변경

#### 대상 파일
- `src/game/PixiApp.ts` (기존, `class PingPongManager` — 현재 838~1037 라인)

#### 변경 1: `tryStart` 내부의 `inPingPong = true` 직접 대입을 `tryStartActivity('pingpong')` + 콜백 등록으로 교체 (현재 905~914 라인)

기존 코드 (905~914 라인):

```ts
for (const a of picked) {
  a.character.inPingPong = true;
  a.character.walkPath([
    a.home.approachInterior,
    a.home.approachCorridor,
    facility.approachCorridor,
    facility.approachInterior,
    a.spot,
  ]);
}
```

새 코드:

```ts
// Try to claim both characters atomically. If either refuses, abort
// the match before assigning any walk paths.
const accepted = picked.every((a) => {
  // Set preempt hook BEFORE tryStartActivity so it's wired even if
  // another activity preempts pingpong on the next tick.
  a.character.onActivityPreempt = (by) => {
    // Preempted by something higher (only 'work' beats pingpong).
    // Stop the ball, send everyone else home, abandon the game.
    void by;
    this.handleExternalAbort(facility);
  };
  return a.character.tryStartActivity('pingpong');
});
if (!accepted) {
  // Roll back any character we did manage to claim.
  for (const a of picked) {
    if (a.character.currentActivity === 'pingpong') {
      a.character.endActivity('pingpong');
    }
    a.character.onActivityPreempt = undefined;
  }
  return;
}

for (const a of picked) {
  a.character.walkPath([
    a.home.approachInterior,
    a.home.approachCorridor,
    facility.approachCorridor,
    facility.approachInterior,
    a.spot,
  ]);
}
```

#### 변경 2: 새 메서드 `handleExternalAbort` 추가 (cleanup 메서드 직전, 936 라인 부근)

```ts
/**
 * Called when one of our players is preempted by a higher-priority
 * activity (work). Send the OTHER (still-pingpong) players home and
 * tear down the game. The preempted player is already off our hands —
 * tryStartActivity has cleared their currentActivity.
 */
private handleExternalAbort(facility: FacilityInfo): void {
  if (!this.game) return;
  for (const other of this.game.attendees) {
    if (other.character.container.destroyed) continue;
    if (other.character.currentActivity === 'pingpong') {
      // Still ours — release and walk home.
      other.character.endActivity('pingpong');
      other.character.walkPath([
        facility.approachInterior,
        facility.approachCorridor,
        other.home.approachCorridor,
        other.home.approachInterior,
        this.randomHomeTarget(other),
      ]);
    }
  }
  this.cleanup();
}
```

#### 변경 3: `tickGame`의 외부 풀링 감지 로직을 활동 시스템 기반으로 교체 (현재 964~981 라인)

기존 (964~981):

```ts
// Bail out if any attendee was externally pulled (destroyed or state→working).
// `inPingPong === false` here means something other than us cleared the flag.
for (const a of g.attendees) {
  if (
    a.character.container.destroyed ||
    !a.character.inPingPong ||
    a.character.state !== 'idle'
  ) {
    // Other attendees should still head back to their rooms on their own.
    for (const other of g.attendees) {
      if (other === a) continue;
      if (other.character.container.destroyed) continue;
      if (other.character.inPingPong) this.sendHome(other, facility);
    }
    this.cleanup();
    return;
  }
}
```

새 코드:

```ts
// Bail out if any attendee was destroyed. Preemption is now handled via
// onActivityPreempt → handleExternalAbort, so we no longer need to poll
// inPingPong / state here. We only check destroyed (cull on session close).
for (const a of g.attendees) {
  if (a.character.container.destroyed) {
    for (const other of g.attendees) {
      if (other === a) continue;
      if (other.character.container.destroyed) continue;
      if (other.character.currentActivity === 'pingpong') {
        this.sendHome(other, facility);
      }
    }
    this.cleanup();
    return;
  }
}
```

#### 변경 4: `sendHome`에서 `endActivity` 호출 (현재 950~959 라인)

기존:

```ts
private sendHome(a: PingPongAttendee, facility: FacilityInfo) {
  a.character.inPingPong = false;
  a.character.walkPath([...]);
}
```

새 코드:

```ts
private sendHome(a: PingPongAttendee, facility: FacilityInfo) {
  a.character.endActivity('pingpong');
  a.character.walkPath([
    facility.approachInterior,
    facility.approachCorridor,
    a.home.approachCorridor,
    a.home.approachInterior,
    this.randomHomeTarget(a),
  ]);
}
```

#### 변경 5: 정상 종료(`PINGPONG_PLAY_SECONDS` 만료) 경로는 그대로 `sendHome` 호출이라 자동 해결됨 (현재 1032~1035 라인). 변경 불필요.

#### 성공 기준
- 탁구 진행 중 `agent-tool` SSE 이벤트가 도착해 sync에서 work 활동을 시작하면(Task 5 참조), `onActivityPreempt`가 발화하고 다른 플레이어가 home으로 복귀하며, 탁구 게임이 즉시 cleanup된다.
- 탁구 진행 중 화장실 wander 시도(`pickWanderTarget` → bathroom 분기)는 `tryStartActivity('toilet')`이 false를 반환해 무시된다 (Task 4 참조).
- 정상 종료(15초 만료)는 양쪽 다 home으로 복귀.

---

### Task 4: Character의 wander/chatter/bathroom 트리거를 활동 시스템 기반으로 변경

#### 대상 파일
- `src/game/PixiApp.ts` (기존, `Character.pickWanderTarget` — 277~345 라인, `Character.tick` 562~630 라인, `Character.sayChatter` 363~367 라인)

#### 변경 1: bathroom 분기 (현재 288~328 라인)

`pickWanderTarget` 내부의 bathroom 시작 부분(297 라인 `this.saySpeech(randomBathroomLine());` 직전)에 가드를 추가:

```ts
if (bathroom && roll < 0.14) {
  if (!this.tryStartActivity('toilet')) {
    // Higher-priority activity already running — fall through to plain wander.
    this.walkTo(z.x + Math.random() * z.w, z.y + Math.random() * z.h);
    this.wanderDwell = 1.5 + Math.random() * 4;
    this.wanderTimer = 0;
    return;
  }
  const ex = this.corridorExcursion!;
  // ... existing bathroom path build ...
```

그리고 `startDwell`의 콜백에서 `this.inBathroom = false;` 라인(현재 313 라인)을 다음으로 교체:

```ts
this.startDwell(5, () => {
  this.endActivity('toilet');
  this.walkPath([
    bathroom.approachInterior,
    bathroom.approachCorridor,
    ex.approachCorridor,
    ex.approachInterior,
    back,
  ]);
});
```

`inBathroom = true;`(현재 310 라인)는 **삭제** — `tryStartActivity('toilet')`이 `syncActivityMirrors`를 통해 자동 set한다.

#### 변경 2: corridor excursion 분기 (현재 330~340 라인)

이건 wander 활동의 일종이다. 추가 변경:

```ts
if (canExcursion && roll < 0.22) {
  if (!this.tryStartActivity('wander')) {
    // Some higher-priority activity is running — skip.
    return;
  }
  const ex = this.corridorExcursion!;
  // ... existing excursion path build (already calls walkPath) ...
  // After walkPath returns we don't have a natural completion hook
  // to call endActivity('wander'), so attach it via pathOnComplete:
  // the existing walkPath has no callback on the last leg, so we
  // wrap it.
}
```

기존 excursion 코드는 `walkPath([...])`만 호출하고 콜백이 없다. 콜백 추가:

```ts
this.walkPath(
  [ex.approachInterior, ex.approachCorridor, { x: cx, y: cy }, ex.approachCorridor, ex.approachInterior, back],
  () => {
    this.endActivity('wander');
  }
);
this.wanderDwell = 4 + Math.random() * 3;
this.wanderTimer = 0;
return;
```

#### 변경 3: 일반 wander (마지막 분기, 현재 342~344 라인)

```ts
// Plain in-room wander — also a 'wander' activity but very short.
// We don't try to claim the slot for plain wander because it would
// constantly conflict with chatter; instead, plain wander is the
// "no activity" baseline and skips the slot entirely.
this.walkTo(z.x + Math.random() * z.w, z.y + Math.random() * z.h);
this.wanderDwell = 1.5 + Math.random() * 4;
this.wanderTimer = 0;
```

**중요한 설계 결정:** 평범한 in-room wander와 chatter는 활동 슬롯을 **점유하지 않는다**. 이들은 진정한 "유휴 활동(idle activity)"이고, 슬롯에 넣으면 매 1.5초마다 슬롯이 빠르게 점유/해제되어 더 높은 활동의 시작을 막을 일이 없는데 복잡도만 늘어난다. 슬롯은 "독점적으로 길게 가는 활동"(work / pingpong / toilet / corridor-excursion)에만 쓴다.

이는 요구사항의 "그냥 이동(wander)" 우선순위(0)와 약간 어긋나 보일 수 있으나, 우선순위 0의 의미는 **"어떤 활동 중에도 무시되지 않을 만큼 가벼운 백그라운드 동작"**으로 해석한다. tick 가드(아래 변경 4)에서 더 높은 활동이 슬롯을 점유 중이면 wander/chatter는 자연스럽게 차단된다.

#### 변경 4: tick의 wander/chatter 가드를 활동 슬롯 기반으로 교체 (현재 562~571, 617~624 라인)

기존 wander 가드 (562~571):

```ts
if (
  !walking &&
  this.dwellTimer <= 0 &&
  this.state === 'idle' &&
  this.wanderZone &&
  !this.inMeeting &&
  !this.inPingPong &&
  !this.inBathroom
) {
```

새 코드:

```ts
if (
  !walking &&
  this.dwellTimer <= 0 &&
  this.state === 'idle' &&
  this.wanderZone &&
  this.currentActivity === null &&
  !this.inMeeting
) {
```

기존 chatter 가드 (618~624):

```ts
if (
  this.bubbleState === 'hidden' &&
  this.state === 'idle' &&
  !this.inMeeting &&
  !this.inPingPong &&
  !this.inBathroom
) {
```

새 코드:

```ts
if (
  this.bubbleState === 'hidden' &&
  this.state === 'idle' &&
  this.currentActivity === null &&
  !this.inMeeting
) {
```

**근거:** `currentActivity === null`이면 자동으로 pingpong/toilet/wander 모두 비활성. `inMeeting`은 Task 6에서 활동 시스템에 흡수될 때까지 별도 유지.

#### 변경 5: `walkTo`의 `this.inBathroom = false;` 라인(현재 231 라인)

이 라인은 외부에서 `walkTo`를 부르면 화장실 상태가 강제로 풀려야 한다는 가정인데, 이제 활동 시스템이 단일 진실 소스다. 이 라인은 **삭제**한다. 화장실 종료는 `endActivity('toilet')` 한 곳에서만 일어나야 한다.

#### 성공 기준
- 탁구 중에 `pickWanderTarget`을 호출해도 bathroom 분기 진입 시 `tryStartActivity('toilet')` 실패 → 평범한 in-room wander로 떨어짐.
- 화장실 dwell 끝나면 `endActivity('toilet')`가 호출되어 `currentActivity` → null, `inBathroom` → false.
- 화장실/탁구/work 중에는 chatter 말풍선이 뜨지 않음.
- `tsc --noEmit` 통과.

---

### Task 5: sync()에서 work 활동 시작/종료를 활동 시스템에 연결

#### 대상 파일
- `src/game/PixiApp.ts` (기존, `function sync` — 1529~1661 라인)

#### 변경: state 전이 처리 블록 (현재 1614~1628 라인)

기존:

```ts
const prevState = ch.state;
ch.state = ag.state;

if (!isNew && prevState !== ag.state) {
  if (ag.state === 'working' || ag.state === 'walking_to_desk') {
    const t = deskFor(room, agentName);
    ch.walkPath([room.approachInterior, t]);
  } else {
    ch.pickWanderTarget();
  }
} else if (isNew && (ag.state === 'working' || ag.state === 'walking_to_desk')) {
  const t = deskFor(room, agentName);
  ch.walkPath([room.approachInterior, t]);
}
```

새 코드:

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

**핵심:** `tryStartActivity('work')`가 호출되면 Task 2의 우선순위 비교에 의해 무엇이 진행 중이든 선점된다. PingPongManager는 `onActivityPreempt` 콜백으로 `handleExternalAbort`를 받아 cleanup → 다른 플레이어 home 복귀.

또한 work 진행 중 또 `agent-tool`이 와서 다시 sync가 호출돼도 `prevState === ag.state === 'working'`이면 if 블록 진입 X, `currentActivity`는 그대로 'work'.

#### 변경: 캐릭터 destroy 직전 정리 (현재 1554~1556 라인)

```ts
for (const [key, ch] of characters) {
  if (key.startsWith(sid + ':')) {
    ch.container.destroy({ children: true });
    characters.delete(key);
  }
}
```

이 destroy는 기존 PingPongManager의 `tickGame` 폴링에 의해 cleanup이 트리거됐다. Task 3 변경 3 이후에도 `container.destroyed` 체크는 유지하므로 변경 불필요.

#### 성공 기준
- 탁구 시작 후 해당 캐릭터에 `agent-tool` 이벤트 → store가 `state='working'` → sync → `tryStartActivity('work')` → preempt → PingPongManager cleanup → 책상으로 walk.
- work 종료(`agent-stop`) → `state='idle'` → `endActivity('work')` → `pickWanderTarget()`.
- 신규 세션의 main 캐릭터가 working으로 시작하면 `tryStartActivity('work')` 호출.

---

### Task 6: MeetingManager를 활동 시스템에 통합

#### 대상 파일
- `src/game/PixiApp.ts` (기존, `class MeetingManager` — 701~802 라인)

Meeting은 현재 5개 우선순위 목록에 명시되지 않았으나, 동일한 선점 문제를 가진다. **요구사항 범위 외**라고 판단되면 Task 6은 생략 가능. 다만 work가 회의를 선점할 수 없으면 일관성이 깨지므로, 최소한 work 선점만 지원하도록 제한적으로 통합한다.

**선택된 정책:** Meeting은 새 활동 시스템에서 임시로 `'pingpong'`과 동급 우선순위 3을 가진다 (탁구와 회의가 동시에 한 캐릭터에서 발생할 수 없음). 단, 요구사항이 회의를 명시하지 않았으므로 **새 ActivityKind에는 추가하지 않고**, MeetingManager가 work 선점만 별도로 처리한다.

#### 변경 1: `maybeStart` 내부의 idle 후보 필터(현재 729~735 라인)에 활동 슬롯 체크 추가

```ts
for (const [k, c] of characters) {
  if (!k.startsWith(sid + ':')) continue;
  if (c.state !== 'idle') continue;
  if (c.inMeeting) continue;
  if (c.currentActivity !== null) continue; // skip pingpong / toilet / wander-excursion / work
  idleHere.push(c);
}
```

#### 변경 2: attendee 합류 시(747~752 라인) work-preempt 콜백 등록

```ts
attendees.forEach((c, i) => {
  c.inMeeting = true;
  // Allow work to preempt an in-progress meeting.
  c.onActivityPreempt = (by) => {
    void by;
    // Pull this attendee out of the meeting; the rest continue.
    c.inMeeting = false;
  };
  // We DON'T call tryStartActivity here because meeting is not in
  // ActivityKind. Instead, work preemption goes through onActivityPreempt
  // only if work later calls tryStartActivity('work') on this character.
  homeZones.push(c.wanderZone);
  // ... existing offset / walkTo ...
});
```

**주의:** 위 접근은 부분적이다. 회의 중에 work가 도착하면 `tryStartActivity('work')`가 호출되는데, `currentActivity === null`(meeting은 슬롯에 없음)이라 분기 1로 떨어져 그냥 work 슬롯 차지하고 끝난다. preempt 콜백이 발화하지 않는다.

**대안 (권장):** Meeting을 정식 ActivityKind로 추가한다.

```ts
type ActivityKind = 'work' | 'meeting' | 'pingpong' | 'toilet' | 'chatter' | 'wander';

const ACTIVITY_PRIORITY: Record<ActivityKind, number> = {
  work: 4,
  meeting: 3,
  pingpong: 3, // 동급 — 둘 다 3, 한 캐릭터에서 동시 발생 불가능 (필터로 보장)
  toilet: 2,
  chatter: 1,
  wander: 0,
};
```

`tryStartActivity`의 비교가 `next <= cur`로 동급 거부이므로, 회의 진행 중 탁구 시도(또는 그 반대)는 자동 거부된다 — 정확한 동작.

`syncActivityMirrors`도 갱신:

```ts
private syncActivityMirrors(kind: ActivityKind | null): void {
  this.inMeeting = kind === 'meeting';
  this.inPingPong = kind === 'pingpong';
  this.inBathroom = kind === 'toilet';
}
```

MeetingManager는 attendee 합류 시 `tryStartActivity('meeting')` + preempt 콜백 등록으로 변경. 회의 종료 시(786~790 라인) `endActivity('meeting')`.

#### 변경 3: 회의 attendee 합류 (747~752 라인) — 권장 안 적용

```ts
const accepted = attendees.every((c) => {
  c.onActivityPreempt = (by) => {
    void by;
    // Mark this attendee as having left the meeting; meeting tickMeeting
    // will detect missing attendees on next tick.
    c.inMeeting = false;
  };
  return c.tryStartActivity('meeting');
});
if (!accepted) {
  for (const c of attendees) {
    if (c.currentActivity === 'meeting') c.endActivity('meeting');
    c.onActivityPreempt = undefined;
    c.inMeeting = false;
  }
  return;
}
attendees.forEach((c, i) => {
  homeZones.push(c.wanderZone);
  const offset = (i - (attendees.length - 1) / 2) * 14;
  c.walkTo(spot.x + offset, spot.y + (i % 2 === 0 ? 0 : 4));
});
```

#### 변경 4: 회의 종료 (786~790 라인)

```ts
for (const c of m.attendees) {
  c.endActivity('meeting');
  c.pickWanderTarget();
}
```

#### 변경 5: `tickMeeting`에 preempt 감지 추가 (770 라인 부근, gather/talk 양쪽)

```ts
// Drop attendees that were preempted (currentActivity is no longer 'meeting').
const remaining = m.attendees.filter((c) => c.currentActivity === 'meeting' && !c.container.destroyed);
if (remaining.length < m.attendees.length) {
  // Some were preempted. If too few remain, end the meeting.
  if (remaining.length < 2) {
    for (const c of remaining) {
      c.endActivity('meeting');
      c.pickWanderTarget();
    }
    m.phase = 'done';
    return;
  }
  m.attendees = remaining;
}
```

#### 성공 기준
- 회의 진행 중 work 도착 → 해당 attendee preempted → meeting attendees < 2면 회의 종료.
- 회의 진행 중 같은 캐릭터에 탁구 시도 → 후보 필터에서 제외(`currentActivity !== null`).
- 회의 종료 시 모든 attendee의 `currentActivity` → null.

---

## Task 순서

```
Step 1 (병렬 가능 — 같은 파일이지만 서로 다른 영역):
  - Task 1: ActivityKind / ACTIVITY_PRIORITY 정의
  - Task 2: Character 슬롯 + tryStartActivity / endActivity / syncActivityMirrors

Step 2 (순차, Task 2에 의존):
  - Task 3: PingPongManager 통합
  - Task 4: pickWanderTarget / tick / walkTo 가드 통합
  - Task 5: sync()에서 work 진입/이탈 처리
  - Task 6: MeetingManager 통합 (권장 안 — meeting을 ActivityKind에 추가)
```

같은 파일이라 실제로는 순차로 implementer가 한 번에 편집한다. Task 1→2→(3,4,5,6) 순서로 진행.

---

## 하지 않는 것

- **SSE 스키마 / 타입 변경 없음** — `src/types.ts`, `server/`, `src/store.ts`는 손대지 않는다. work 이벤트의 정의는 기존 `agent-tool` / `agent-stop` 그대로다.
- **새로운 활동 종류 추가 없음** — 화장실 횟수 제한, 탁구 멤버 수 변경 등 인접 개선 금지.
- **ActivityKind 우선순위 외부 노출 없음** — 모듈 내부 상수로만 사용. UI에 표시하지 않는다.
- **테스트** — implementer는 코드만 변경. 테스트는 별도 test-writer 단계에서 작성.
- **시각 효과 변경 없음** — 활동 전환 시 fade / 깜빡임 등 추가 시각 피드백 없음. 캐릭터 애니메이션은 기존 inPingPong 미러를 그대로 사용.
- **권한 게이트와의 상호작용** — permission 말풍선은 기존 `bubbleKind === 'permission'` 경로 그대로. 활동 시스템과 독립.

---

## 참고 코드 위치 정리 (구현 시 빠르게 찾기 위함)

| 항목 | 파일 | 라인 |
|---|---|---|
| Character 클래스 시작 | `src/game/PixiApp.ts` | 102 |
| `inMeeting/inPingPong/inBathroom` 선언 | `src/game/PixiApp.ts` | 151~153 |
| `walkTo`의 `inBathroom = false` | `src/game/PixiApp.ts` | 231 |
| `pickWanderTarget` | `src/game/PixiApp.ts` | 277~345 |
| bathroom 분기 | `src/game/PixiApp.ts` | 288~328 |
| corridor excursion 분기 | `src/game/PixiApp.ts` | 330~340 |
| `tick` wander 가드 | `src/game/PixiApp.ts` | 562~576 |
| `tick` chatter 가드 | `src/game/PixiApp.ts` | 617~630 |
| `tick` 애니메이션 frame | `src/game/PixiApp.ts` | 633~651 |
| MeetingManager | `src/game/PixiApp.ts` | 701~802 |
| `maybeStart` 후보 필터 | `src/game/PixiApp.ts` | 728~735 |
| 회의 attendee 합류 | `src/game/PixiApp.ts` | 747~752 |
| 회의 종료 | `src/game/PixiApp.ts` | 786~791 |
| PingPongManager | `src/game/PixiApp.ts` | 838~1037 |
| `tryStart` 합류 | `src/game/PixiApp.ts` | 905~914 |
| `sendHome` | `src/game/PixiApp.ts` | 950~959 |
| `tickGame` 외부 풀링 감지 | `src/game/PixiApp.ts` | 964~981 |
| `sync` state 전이 | `src/game/PixiApp.ts` | 1614~1628 |

---

## 사용자 결정사항 (확정, 2026-04-15)

### 결정 1: Task 6 — Meeting을 정식 ActivityKind에 편입
- **옵션 1 채택.** Task 6 권장안(Meeting을 `ActivityKind`에 추가, 우선순위 3, pingpong과 동급) 그대로 진행.
- `ActivityKind = 'work' | 'meeting' | 'pingpong' | 'toilet' | 'chatter' | 'wander'`
- 우선순위: `work=4 > meeting=3 == pingpong=3 > toilet=2 > chatter=1 > wander=0`
- `syncActivityMirrors`는 `inMeeting = kind === 'meeting'`로 확장. MeetingManager가 직접 `inMeeting`을 set/clear하던 기존 경로는 모두 제거되고 `tryStartActivity('meeting')` / `endActivity('meeting')`를 통해서만 바뀐다.
- Task 6 "대안 (권장)" 섹션에 기술된 변경사항 3, 4, 5가 모두 필수 Task다. "선택된 정책" 단락과 변경 1~2의 부분 통합(workaround) 안은 **버린다**.
- Task 2의 `syncActivityMirrors` 주의 문구("`inMeeting`을 건드리지 않는다")는 **무효**. 다음 코드로 교체한다:

```ts
private syncActivityMirrors(kind: ActivityKind | null): void {
  this.inMeeting = kind === 'meeting';
  this.inPingPong = kind === 'pingpong';
  this.inBathroom = kind === 'toilet';
}
```

### 결정 2: 화장실 수용량 (정원 2, 소변기 2개, 대기 큐 FIFO)
- 화장실 동시 정원 = **소변기 슬롯 수 = 2**.
- 슬롯이 모두 차 있으면 진입 희망자는 **화장실 외부 대기 위치**에 선다 (무한 FIFO 큐).
- 사용자가 소변기를 떠나면 대기 큐의 선두가 dequeue되어 빈 슬롯을 점유하고 해당 좌표로 walk.
- work 이벤트로 선점되면(Task 5의 `tryStartActivity('work')`) 해당 캐릭터는 슬롯/큐에서 제거된다.
- 큐 길이 제한은 없음 (자연스러운 agent 수 상한 = 세션 수로 충분히 작음).

이 결정은 새 Task 7~11로 추가된다. Task 1~6의 설계는 유지된다. Task 4의 bathroom 분기는 "`tryStartActivity('toilet')` 성공 시 바로 소변기 좌표로 walk"에서 "`BathroomManager.request(this)` 결과에 따라 슬롯 또는 대기 위치로 walk"로 변경된다.

---

## Task 7: BathroomManager 타입 및 상수 정의

### 대상 파일
- `src/game/PixiApp.ts` (기존)

### 추가 위치
- 최상단 `FacilityInfo` 타입 선언 직후 (현재 1039~1048 라인 부근)에 BathroomManager 관련 타입을 추가. BathroomManager 클래스 자체는 `class PingPongManager` 선언 **직전**(현재 838 라인 직전)에 삽입한다. 이유: MeetingManager / PingPongManager와 동일한 레이어의 "facility manager"이므로 같은 영역에 모아둔다.

### 추가 타입 / 상수

```ts
// Fixed per the design: 2 urinal slots, one per stall.
// Indices match `bathroomDwellSpots` (the array built around line 1178).
// Slot 0 = upper stall urinal, Slot 1 = lower stall urinal.
const BATHROOM_URINAL_COUNT = 2;

type UrinalSlotIndex = 0 | 1;

type BathroomSlotState = {
  index: UrinalSlotIndex;
  occupant: Character | null;
};

type BathroomWaiter = {
  character: Character;
  // Resolved when this waiter is later assigned a slot. Used by
  // Character.pickWanderTarget to issue the walk path to the assigned
  // urinal — see Task 9.
  onAssigned: (slot: UrinalSlotIndex) => void;
};
```

### 추가할 외부 좌표 상수
BathroomManager가 "대기 위치"로 쓸 좌표를 `bathroomDwellSpots` 계산부(현재 1178~1193 라인) 바로 다음에 추가한다:

```ts
// Two queue waiting spots just OUTSIDE the bathroom door, on the corridor
// side. Characters stand here when both urinals are occupied. They face
// the bathroom entrance while waiting.
const bathroomQueueWaitSpots: Array<{ x: number; y: number }> = [
  {
    // First in line — stand right next to the bathroom door on the corridor.
    x: bathroomBounds.x + bathroomBounds.w + 6,
    y: bathroomBounds.y + bathroomBounds.h / 2 - 4,
  },
  {
    // Second in line — one tile further into the corridor.
    x: bathroomBounds.x + bathroomBounds.w + 14,
    y: bathroomBounds.y + bathroomBounds.h / 2 + 4,
  },
];
```

큐 길이가 2를 넘으면(3번째 이후) 좌표는 `bathroomQueueWaitSpots[1]`로 폴백한다 (모두 같은 스팟에 겹쳐 서는 것을 허용). 이는 Task 9의 `assignWaitSpot` 로직에 명시한다.

`FacilityInfo`에 새 필드 추가:

```ts
type FacilityInfo = {
  name: 'toilet' | 'pingpong';
  label: string;
  bounds: Rect;
  doorSide: 'left' | 'right';
  interiorZone: Rect;
  approachInterior: { x: number; y: number };
  approachCorridor: { x: number; y: number };
  dwellSpots?: Array<{ x: number; y: number }>;
  queueWaitSpots?: Array<{ x: number; y: number }>; // NEW — toilet only
};
```

그리고 `facilities[0]` (`name: 'toilet'`) 리터럴에 `queueWaitSpots: bathroomQueueWaitSpots` 항목을 추가한다 (현재 1215 라인의 `dwellSpots: bathroomDwellSpots,` 다음 줄).

### 성공 기준
- `tsc --noEmit` 통과
- `BATHROOM_URINAL_COUNT === bathroomDwellSpots.length` 가정이 유지됨 (구현 시 `if (bathroomDwellSpots.length !== BATHROOM_URINAL_COUNT) throw new Error(...)` 식의 런타임 assert는 **넣지 않는다** — 상수가 같은 파일 안에서 고정되어 불변이므로).

---

## Task 8: BathroomManager 클래스 구현

### 대상 파일
- `src/game/PixiApp.ts` (기존, `class PingPongManager` 선언 직전)

### 클래스 설계

```ts
class BathroomManager {
  // Fixed-size array of slot states. Initialized once in the constructor.
  private slots: BathroomSlotState[] = [
    { index: 0, occupant: null },
    { index: 1, occupant: null },
  ];

  // FIFO queue of waiters. `shift()` on release, `push()` on request.
  private queue: BathroomWaiter[] = [];

  /**
   * Try to claim a urinal for `character`. Returns one of:
   *   - { kind: 'assigned', slot }  → immediately got a urinal
   *   - { kind: 'queued', position } → appended to the queue; caller should
   *                                    walk to the wait spot at `position`
   *
   * Caller MUST have already called `character.tryStartActivity('toilet')`
   * and received true. This manager only tracks physical occupancy; the
   * activity slot is the single source of truth for "am I doing toilet".
   *
   * `onAssigned` is stored on the waiter entry and invoked later by
   * `releaseUrinal` when a slot frees up. For callers that get an immediate
   * assignment (kind === 'assigned'), `onAssigned` is NOT invoked — the
   * caller already knows the slot from the return value.
   */
  request(
    character: Character,
    onAssigned: (slot: UrinalSlotIndex) => void
  ): { kind: 'assigned'; slot: UrinalSlotIndex } | { kind: 'queued'; position: number } {
    const free = this.slots.find((s) => s.occupant === null);
    if (free) {
      free.occupant = character;
      return { kind: 'assigned', slot: free.index };
    }
    this.queue.push({ character, onAssigned });
    return { kind: 'queued', position: this.queue.length - 1 };
  }

  /**
   * Called when a character finishes using a urinal (dwell timer elapsed)
   * OR when they are preempted while occupying a slot. Frees the slot and,
   * if a waiter is queued, assigns them the freed slot and invokes their
   * `onAssigned` callback.
   *
   * No-op if `character` does not currently occupy a slot (e.g. they were
   * in the queue, or they were never in the bathroom at all — idempotent).
   */
  releaseUrinal(character: Character): void {
    const slot = this.slots.find((s) => s.occupant === character);
    if (!slot) return;
    slot.occupant = null;

    // Promote next waiter if any.
    const next = this.queue.shift();
    if (next) {
      slot.occupant = next.character;
      next.onAssigned(slot.index);
    }
  }

  /**
   * Remove `character` from the wait queue. Used when a queued waiter is
   * preempted by a higher-priority activity (work). No-op if not in queue.
   */
  removeFromQueue(character: Character): void {
    const idx = this.queue.findIndex((w) => w.character === character);
    if (idx !== -1) this.queue.splice(idx, 1);
  }

  /**
   * Combined cleanup: remove the character from BOTH slot and queue.
   * Safe to call from preempt callbacks without knowing which state the
   * character was in.
   */
  evict(character: Character): void {
    this.releaseUrinal(character);
    this.removeFromQueue(character);
  }

  /**
   * Return the world coordinates of the N-th wait spot. Positions beyond
   * the defined spots collapse to the last defined spot (characters stack).
   */
  waitSpotFor(position: number, facility: FacilityInfo): { x: number; y: number } {
    const spots = facility.queueWaitSpots ?? [];
    if (spots.length === 0) {
      // Defensive fallback — should not happen if Task 7 wired queueWaitSpots.
      return facility.approachCorridor;
    }
    return spots[Math.min(position, spots.length - 1)];
  }

  /**
   * Return the world coordinates of the urinal at slot `idx`. Delegates to
   * the existing `dwellSpots` array on the facility (2 entries, indices 0/1).
   */
  urinalSpotFor(idx: UrinalSlotIndex, facility: FacilityInfo): { x: number; y: number } {
    const spots = facility.dwellSpots ?? [];
    return spots[idx] ?? facility.approachInterior;
  }
}
```

### 인스턴스화
`const meetings = new MeetingManager();` 바로 다음 줄(현재 1664 라인)에 추가:

```ts
const bathroom = new BathroomManager();
const bathroomFacility = facilities[0];
```

`bathroomFacility`는 Task 9가 Character의 preempt 콜백 내부에서 manager 접근 시 facility 좌표를 조회할 때 필요하다. 대신 `Character`에는 `bathroomManager: BathroomManager | null`를 주입해야 한다 — Task 9 참조.

### `app.ticker.add` 확장
BathroomManager는 tick 기반 동작이 없다 (모든 동작이 request/release 이벤트에 반응). 따라서 ticker에는 추가하지 않는다.

### 성공 기준
- 동일 캐릭터가 `request` → `releaseUrinal` 호출 시 대기자가 있으면 대기자의 `onAssigned` 콜백이 해당 슬롯 index로 호출됨
- `evict`가 슬롯 점유자든 대기자든 모두 안전하게 제거
- `tsc --noEmit` 통과

---

## Task 9: pickWanderTarget의 bathroom 분기를 BathroomManager 기반으로 교체

### 대상 파일
- `src/game/PixiApp.ts` (기존, `Character.pickWanderTarget` 277~345 라인)

### 의존성 주입
`Character` 클래스에 새 필드를 추가한다 (현재 156~160 라인의 `facilities` 필드 선언 근처):

```ts
private bathroomManager: BathroomManager | null = null;

setBathroomManager(m: BathroomManager): void {
  this.bathroomManager = m;
}
```

`createPixiApp`의 캐릭터 생성부(Grep으로 `new Character(` 검색해 위치 확정, 대략 sync 내부 1580 라인 부근 "character create on new key")에서 `ch.setBathroomManager(bathroom);` 호출을 생성 직후 추가한다. 또한 `bathroomFacility`에도 접근이 필요하므로, Character에 `setBathroomFacility(f: FacilityInfo)` 대신 **Task 7의 `setFacilities(fs)` 호출이 이미 `facilities[0]`을 포함해 캐릭터에 전달하고 있으므로** 추가 setter는 불필요. Character 내부에서 `this.facilities.find((f) => f.name === 'toilet')`로 접근한다.

### 교체할 코드
현재 288~328 라인의 bathroom 분기 전체(Task 4의 변경 1에서 수정된 결과)를 다음으로 완전히 교체:

```ts
if (bathroom && roll < 0.14) {
  if (!this.tryStartActivity('toilet')) {
    // Higher-priority activity running — fall through to plain wander.
    this.walkTo(z.x + Math.random() * z.w, z.y + Math.random() * z.h);
    this.wanderDwell = 1.5 + Math.random() * 4;
    this.wanderTimer = 0;
    return;
  }

  const ex = this.corridorExcursion!;
  const back = { x: z.x + Math.random() * z.w, y: z.y + Math.random() * z.h };
  const mgr = this.bathroomManager;

  if (!mgr) {
    // Manager not wired — should not happen in runtime. Abort the toilet
    // activity cleanly so we don't leave the slot stuck.
    this.endActivity('toilet');
    return;
  }

  // Wire preempt BEFORE requesting a slot so that if `request` synchronously
  // triggers anything (it doesn't today, but defensive), preempt handling
  // is already in place.
  this.onActivityPreempt = (_by) => {
    mgr.evict(this);
  };

  // Reusable helper: what to do once we physically arrive at a urinal
  // (either immediately assigned, or later promoted from the queue).
  const onArriveAtUrinal = () => {
    this.saySpeech(randomBathroomDwellLine());
    // Face upward while using the urinal. See Task 11 for facing details.
    this.facing = 'up';
    this.startDwell(5, () => {
      // Finished using. Release the slot (which may promote a waiter),
      // then walk home via the corridor.
      mgr.releaseUrinal(this);
      this.endActivity('toilet');
      this.onActivityPreempt = undefined;
      this.walkPath([
        bathroom.approachInterior,
        bathroom.approachCorridor,
        ex.approachCorridor,
        ex.approachInterior,
        back,
      ]);
    });
  };

  const result = mgr.request(this, (slot) => {
    // Late-assigned from the queue. We are currently standing at a wait
    // spot. Walk to the urinal (interior approach → urinal spot) and
    // then trigger the dwell.
    const urinalSpot = mgr.urinalSpotFor(slot, bathroom);
    this.walkPath(
      [bathroom.approachInterior, urinalSpot],
      onArriveAtUrinal
    );
  });

  this.saySpeech(randomBathroomLine());

  if (result.kind === 'assigned') {
    const urinalSpot = mgr.urinalSpotFor(result.slot, bathroom);
    this.walkPath(
      [
        ex.approachInterior,
        ex.approachCorridor,
        bathroom.approachCorridor,
        bathroom.approachInterior,
        urinalSpot,
      ],
      onArriveAtUrinal
    );
  } else {
    // Queued — walk to the wait spot outside the bathroom door.
    const waitSpot = mgr.waitSpotFor(result.position, bathroom);
    this.walkPath(
      [ex.approachInterior, ex.approachCorridor, waitSpot],
      () => {
        // Arrived at wait spot. Face the bathroom door and stand idle.
        this.facing = 'left'; // bathroom door is on the right side of the bathroom (doorSide: 'right'), so waiter faces left toward the door
        // Do NOT startDwell — we wait indefinitely for onAssigned to fire.
        // When it does, it will call walkPath which clears any state.
      }
    );
  }

  // Wander dwell must cover: travel (~4s) + wait (unbounded) + 5s dwell +
  // return (~4s). Since queue wait is unbounded, we set a LARGE dwell and
  // rely on the activity slot / onAssigned chain instead of the wanderDwell
  // timer to manage re-picking.
  this.wanderDwell = 60;
  this.wanderTimer = 0;
  return;
}
```

### 주의: `walkTo` 호출의 부수효과
Task 4 변경 5에서 `walkTo`의 `this.inBathroom = false;` 라인은 이미 삭제했다. 여기서 중요한 추가 주의: `walkTo`는 `this.dwellOnComplete = undefined`를 수행한다. BathroomManager의 `onAssigned` 콜백에서 `walkPath`를 호출하므로, 대기 중인 캐릭터가 `walkTo`를 우연히 호출할 경로는 없다 — 대기 스팟 도착 후 **`walkTo`/`pickWanderTarget`을 호출하지 않는다**(위 코드에서 `wanderDwell = 60`으로 타이머가 트리거되지 않도록 충분히 크게 둔다).

### preempt 콜백 내부에서의 `this.onActivityPreempt = undefined` 처리
`tryStartActivity`가 호출되면 Task 2의 구현상 preemptCb 실행 **이전에** `this.onActivityPreempt = undefined`로 이미 null화된다. 따라서 `mgr.evict(this)`만 호출하면 충분하다. `evict` 이후 Character는 새 활동(work)이 주도권을 가진다.

### 성공 기준
- 슬롯이 비어 있을 때 `request` → `'assigned'` → 곧바로 소변기로 이동 → 5초 dwell → 슬롯 해제 후 복귀
- 두 번째 캐릭터가 같은 시점에 진입하면 `'assigned'`로 두 번째 슬롯 점유
- 세 번째 캐릭터 진입 시 `'queued'`로 대기 위치로 이동 → 첫 번째 캐릭터 5초 종료 시 `onAssigned` 발화 → 세 번째 캐릭터가 빈 소변기로 walk → dwell → 종료
- 네 번째 캐릭터 진입 시 대기 위치 2번에 서고, 한 사람이 나올 때마다 한 칸씩 앞으로 이동하지 않고(위치 갱신 로직은 단순화 — Task 11 추가 논의), 직접 소변기로 walk

---

## Task 10: preempt 경로에서 BathroomManager 정합성 보장

### 대상 파일
- `src/game/PixiApp.ts` (기존, Character / sync / preempt 관련)

### 변경 없음 (이미 Task 9에서 처리됨)
- 슬롯 점유 중 work 선점: `onActivityPreempt` 콜백이 `mgr.evict(this)` 호출 → `releaseUrinal` 실행 → 해당 슬롯 해제 → 대기 큐 선두 승격
- 대기 큐에 있는 중 work 선점: 동일하게 `mgr.evict(this)` → `removeFromQueue`만 실행 (슬롯 점유자가 아니므로 `releaseUrinal`는 no-op)

### Task 5(sync) 에서 추가 확인
Task 5의 `sync` state 전이 변경 코드는 `tryStartActivity('work')`만 호출한다. 이 호출이 Task 2 내부의 preempt 경로를 트리거해 Character에 등록된 `onActivityPreempt`(= `mgr.evict`)가 실행되므로, **sync 자체에서 BathroomManager를 직접 호출할 필요는 없다**.

### 엣지 케이스 1: 캐릭터 destroy (세션 종료)
`sync`의 캐릭터 destroy 루프(현재 1554~1556 라인)는 단순 `ch.container.destroy`만 한다. 화장실 슬롯을 점유한 채 destroy되면 슬롯이 영구 점유 상태로 남는다. 방지를 위해 destroy 직전에:

```ts
for (const [key, ch] of characters) {
  if (key.startsWith(sid + ':')) {
    bathroom.evict(ch); // NEW — free slot/queue if occupied
    ch.container.destroy({ children: true });
    characters.delete(key);
  }
}
```

`bathroom` 변수명이 전역 스코프에서 `createPixiApp` 내 `const bathroom = new BathroomManager();`와 일치하도록 유지한다. (sync는 createPixiApp 클로저 내부이므로 접근 가능.)

### 엣지 케이스 2: `handleExternalAbort` (PingPong 쪽) 와의 상호작용
PingPong preempt는 pingpong 활동만 정리하며 toilet과 무관하다. BathroomManager는 건드리지 않는다. 변경 불필요.

### 엣지 케이스 3: 동시 할당 경쟁 조건
JavaScript는 싱글 스레드이고 `request`는 동기 함수이므로 슬롯/큐는 경쟁 없음. 두 캐릭터가 같은 tick에 `request`해도 순차 실행되어 한 명은 `'assigned'`, 다음 명은 `'queued'`가 된다. 추가 lock 불필요.

### 성공 기준
- 세션 destroy 중 화장실 점유자가 있었으면 슬롯이 자동 해제됨
- work 선점 후 해당 캐릭터가 재-idle되면 `pickWanderTarget`이 정상 동작 (BathroomManager에 잔존 참조 없음)

---

## Task 11: 시각적 표현 및 소변기/대기 좌표 확정

### 대상 파일
- `src/game/PixiApp.ts` (기존)
- `src/game/sprites.ts` — **변경 없음** (기존 drawBathroom의 stall 그림 그대로 사용)

### 결정 사항

1. **소변기 좌표:** 기존 `bathroomDwellSpots` 배열(1178~1193 라인의 2개 항목)을 그대로 사용. Slot 0 = `bathroomDwellSpots[0]` (위쪽 stall), Slot 1 = `bathroomDwellSpots[1]` (아래쪽 stall). BathroomManager는 이 배열을 facility의 `dwellSpots`로 읽는다. 추가 좌표 계산 없음.

2. **대기 위치 좌표:** Task 7에서 정의한 `bathroomQueueWaitSpots` 2개. 첫 위치는 화장실 오른쪽 문 바로 옆(corridor 쪽), 두 번째는 한 칸 더 복도 안쪽. 큐 3번째 이후는 `bathroomQueueWaitSpots[1]`에 겹침(설계 수용).

3. **facing 방향 (사용 중):** 소변기 사용 중에는 `this.facing = 'up'` — 캐릭터가 벽을 향해 북쪽을 본다. `Character`에 `facing` 필드가 이미 있는지 Grep 확인 필요. **없다면 이 요구사항은 "기존 애니메이션(idle frame)을 그대로 두고 facing 변경 없음"으로 축소**한다. implementer는 Task 11 시작 시 첫 단계로 `grep -n "facing" src/game/PixiApp.ts` 결과를 확인:
   - 결과 있음 → 위 코드의 `this.facing = 'up'` / `this.facing = 'left'` 라인 그대로 유지
   - 결과 없음 → 해당 두 라인을 **삭제** (주석으로 `// facing system not present — visual remains idle frame` 남김)

4. **대기 중 애니메이션:** 기존 idle frame 그대로. `startDwell`을 호출하지 **않는다** (dwell은 시간 기반으로 자동 해제되는데, 우리는 `onAssigned` 이벤트 기반으로 해제해야 하므로 dwell과 섞이면 경쟁). 대신 `walkPath`의 마지막 포인트에 도착하면 Character는 자동으로 `state === 'idle'`이 되어 idle sprite가 렌더링된다. 이미 작동하는 경로.

5. **말풍선:** 도착 즉시 `randomBathroomLine()` / 슬롯 점유 후 `randomBathroomDwellLine()`는 기존 로직 그대로. 대기 중에는 별도 말풍선 없음 (기존에 설계된 `saySpeech` 1회 호출이 충분).

### 성공 기준
- `grep facing` 체크 후 facing 라인이 코드/주석 어느 쪽으로든 일관되게 처리됨
- 소변기 사용자 2명 + 대기자 1명이 동시에 렌더링될 때 위치가 서로 겹치지 않고 시각적으로 구분됨
- `tsc --noEmit` 통과

---

## Task 순서 (갱신)

```
Step 1 (순차, 같은 파일이지만 독립 영역):
  - Task 1: ActivityKind / ACTIVITY_PRIORITY 정의 (meeting 포함, 최종 형태)
  - Task 2: Character 슬롯 + tryStartActivity / endActivity / syncActivityMirrors
           (syncActivityMirrors는 meeting 미러 포함, Task 6 권장안)
  - Task 7: BathroomManager 타입/상수/queueWaitSpots + FacilityInfo 확장

Step 2 (Task 1, 2, 7 모두 완료 후):
  - Task 8: BathroomManager 클래스 구현 + 인스턴스화

Step 3 (Task 2, 8 완료 후, 같은 파일의 독립 영역이라 implementer가 한 번에 편집):
  - Task 3: PingPongManager 통합
  - Task 4: pickWanderTarget / tick / walkTo 가드 통합 (bathroom 분기는 Task 9가 override)
  - Task 5: sync()에서 work 진입/이탈 처리
  - Task 6: MeetingManager 통합 (권장 안 확정 — meeting ActivityKind 추가)
  - Task 9: pickWanderTarget bathroom 분기를 BathroomManager 기반으로 교체
            (Task 4 변경 1을 덮어쓴다; Task 4는 가드 추가만 유효, 상세 walk 로직은 Task 9)
  - Task 10: sync destroy 루프에 `bathroom.evict(ch)` 추가
  - Task 11: 시각 표현 확정 (facing grep 체크)
```

**구현 순서 주의:** Task 4의 bathroom 분기 예시 코드와 Task 9의 최종 코드는 서로 다르다. Implementer는 **Task 9의 코드를 최종본으로 사용**하고, Task 4의 bathroom 분기 예시는 "가드 추가가 필요하다"는 의도만 수용하면 된다. Task 4의 corridor excursion 분기(변경 2)와 plain wander(변경 3)는 Task 9와 독립이므로 그대로 유효.

---

## 하지 않는 것 (추가)

- **대기 줄 재정렬 없음** — 대기자 1이 소변기로 승격되어도 대기자 2가 한 칸 앞(`bathroomQueueWaitSpots[0]`)으로 이동하지 않는다. 이는 의도된 단순화. 다음 프로모션에서 대기자 2는 그대로 소변기로 walk한다.
- **소변기 사용 시간 차등 없음** — 5초 고정 (기존 값 유지).
- **대기 큐 길이 제한 없음** — 무한 FIFO. 5명 이상이 동시에 대기해도 `bathroomQueueWaitSpots[1]`에 겹쳐 서는 것을 수용.
- **소변기 애니메이션 추가 없음** — 물내림 이펙트, 파티클 등 시각 추가 금지.
- **BathroomManager SSE/UI 노출 없음** — 대기 큐 상태는 내부 전용. 패널에 "n명 대기 중" 같은 표시 없음.

---

## 참고 코드 위치 정리 (추가)

| 항목 | 파일 | 라인 |
|---|---|---|
| `bathroomBounds` 정의 | `src/game/PixiApp.ts` | 1165~1170 |
| `bathroomDwellSpots` 계산 | `src/game/PixiApp.ts` | 1178~1193 |
| `facilities[0]` (toilet) 리터럴 | `src/game/PixiApp.ts` | 1196~1216 |
| `FacilityInfo` 타입 | `src/game/PixiApp.ts` | 1039~1048 |
| `drawBathroom` (참고용) | `src/game/sprites.ts` | 295~333 |
| MeetingManager / PingPongManager 사이 (BathroomManager 삽입 지점) | `src/game/PixiApp.ts` | 838 직전 |
| manager 인스턴스화 | `src/game/PixiApp.ts` | 1663~1665 |
| sync 캐릭터 destroy 루프 | `src/game/PixiApp.ts` | 1554~1556 |
