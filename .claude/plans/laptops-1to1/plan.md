# 구현 계획: laptops-1to1

## 배경 / 기대 동작

### 요구사항
1. **버그 수정 (1:1 점유)** — 한 컴퓨터(데스크/랩탑)는 동시에 1명의 에이전트만 점유한다. 누군가 점유 중이면 다른 빈 컴퓨터로 가야 한다.
2. **컴퓨터 수 증가** — 각 방마다 컴퓨터 6대 (방이 6개 → 전체 36대).
3. **레이아웃 변경** — 현재 방 위쪽(혹은 door-opposite 가로 벽)에 일렬로 놓인 책상 3개를 제거하고, 방 좌우 양옆 벽에 긴 테이블을 두고 그 위에 랩탑을 일렬로 둔다 (좌측 3대 + 우측 3대).
4. **시각 상태**
   - 점유되지 않은 랩탑: 닫힌 상태 (얇은 사각형)
   - 점유 중인 랩탑: 열린 상태 (베이스 + 화면, 화면은 `PALETTE.monitorOn`)

### "총 6대"의 해석 결정
요구사항 본문이 "각 방마다 컴퓨터를 총 6대"라고 명시했으므로 **방마다 6대**로 진행한다. 동시 작업 가능 에이전트 ≤ 컴퓨터 수 조건을 만족한다 (현재 한 방의 캐릭터 수 한도는 main + sub 다수 정도이며, sub 에이전트 이름 충돌이 없어도 한 방 6명을 초과할 일은 거의 없다 — 초과 시 폴백 정책은 §설계 결정 7 참고).

---

## 현재 코드 분석

### 1) 기존 데스크 좌표 계산

`src/game/PixiApp.ts:1719-1733` — `buildSlot()` 내부에서 데스크 3개를 가로 일렬로 그린다.

```ts
// Desks along the non-door long wall
const deskFx = new Graphics();
const deskPositions: { x: number; y: number }[] = [];
const deskSpacing = 62;
const deskCount = 3;
const deskRowW = deskCount * 44 + (deskCount - 1) * (deskSpacing - 44);
const startX = bounds.x + (bounds.w - deskRowW) / 2;
// Desks sit against the wall opposite the door
const deskY = doorSide === 'bottom' ? bounds.y + 12 : bounds.y + bounds.h - 42;
for (let i = 0; i < deskCount; i++) {
  const dx = startX + i * deskSpacing;
  drawDesk(deskFx, dx, deskY);
  deskPositions.push({ x: dx + 14, y: deskY + 16 });
}
container.addChild(deskFx);
```

- 각 데스크는 폭 44px, 간격 62px → 가로 3대 일렬.
- `deskPositions[i] = { x: dx + 14, y: deskY + 16 }` → 캐릭터가 설 좌표 (데스크 앞).
- door-opposite 가로 벽에 등을 보이고 앉음.

### 2) 데스크 그리기 (sprites)

`src/game/sprites.ts:93-113` — `drawDesk(g, x, y)`:
- 다리·상판·모니터 본체·`PALETTE.monitor` 베젤·`PALETTE.monitorOn` 스크린이 항상 ON 상태로 그려진다. 점유/비점유 구분 없음.
- 폭 44 / 높이 28(다리 포함). 모니터는 데스크 위쪽으로 12px 솟음.

### 3) 에이전트 → 데스크 매핑 (충돌 버그의 정확한 원인)

`src/game/PixiApp.ts:1870-1878`:
```ts
function deskFor(room: RoomSlot, agentName: string): { x: number; y: number } {
  const idx = stableIndex(agentName, room.deskPositions.length);
  return room.deskPositions[idx] ?? room.deskPositions[0] ?? { x: 80, y: 80 };
}
function stableIndex(s: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % Math.max(1, mod);
}
```

**버그 원인**: 데스크 인덱스를 에이전트 이름의 해시 모드 `deskPositions.length` (현재 3)로 결정한다. **점유 추적 자료구조가 없다.** 두 에이전트의 이름 해시가 동일 인덱스로 떨어지면 같은 데스크 좌표를 그대로 받아서 두 명이 같은 자리에 겹친다.

`src/game/PixiApp.ts:1975-1986` — `routeToDesk()`는 그저 `deskFor()`의 결과를 `walkPath`에 넣어 보낼 뿐이다. 점유 검사도 없고 release도 없다.

### 4) 화장실 1:1 점유 패턴 (참고할 모범)

`src/game/PixiApp.ts:976-1076` — `BathroomManager`:
- `slots: BathroomSlotState[]` 고정 길이 (2개), 각 슬롯에 `occupant: Character | null`
- `request(character, onAssigned)` → 빈 슬롯이 있으면 즉시 점유, 없으면 큐
- `releaseUrinal(character)` → 슬롯 비우고 큐 헤드 promote
- `evict(character)` → 슬롯 + 큐 모두에서 제거 (preempt/세션 종료 시 안전)
- `urinalSpotFor(idx, facility)` → 슬롯 인덱스 → 월드 좌표 변환

**핵심 인사이트**: BathroomManager는 단일 글로벌 인스턴스이고 슬롯이 2개뿐이다. 데스크는 **방마다** 6슬롯이 필요하므로 자료구조 형태가 다르다 (방별 분리).

또한 `src/game/activity.ts:44-94`에 동일 로직이 PixiApp.ts와 별개로 (테스트용) 존재한다 (`BathroomManager`). 이쪽은 `ActivityToken` 인터페이스를 받는 일반화된 버전이다.

### 5) walking_to_desk → working 도착 콜백

`src/game/PixiApp.ts:1975-1986`:
```ts
const routeToDesk = () => {
  ch!.onActivityPreempt = undefined; // work itself never gets preempted
  ch!.tryStartActivity('work');
  const t = deskFor(room, agentName);
  ch!.walkPath([room.approachInterior, t], () => {
    if (ch!.state === 'walking_to_desk') {
      notifyArrivedAtDesk(sid, agentName);
    }
  });
};
```

`walkPath`의 `onComplete`에서 `notifyArrivedAtDesk`가 발사되어 store가 `walking_to_desk → working`을 promote한다. 이 흐름은 좌표만 바뀌면 그대로 동작한다 (path 갱신 시 콜백을 그대로 넘긴다).

### 6) work 종료 시 release 트리거

`src/game/PixiApp.ts:1992-1995`:
```ts
} else if (!becomingWorking && wasWorking) {
  // Leave work (including mid-walk stop): release the slot and resume autonomous behavior.
  ch.endActivity('work');
  ch.pickWanderTarget();
}
```

여기서 `endActivity('work')`는 호출되지만 데스크/랩탑 점유는 해제되지 않는다. **이 자리에 랩탑 release 호출을 끼워야 한다.**

또한 세션 종료 시 캐릭터를 cull하는 `src/game/PixiApp.ts:1899-1909`에서도 release가 필요하다 (`bathroom.evict(ch)` 옆에 추가).

### 7) 방 내부 좌표 / 다른 가구와의 위치 관계

- `ROOM_W = 220`, `ROOM_H = 225` (constants.ts)
- 벽 두께 2px, 인테리어 사용 가능 영역 약 216 × 221
- 도어 사이드: 위쪽 행 방은 `bottom`, 아래쪽 행 방은 `top` (PixiApp.ts:1713)
- **소파**: `couchX = bounds.x + 12`, 폭 70 → x ∈ [bounds.x+12, bounds.x+82]. 도어 사이드의 가로 스트립을 차지.
- **화분**: 우측 두 개. `bounds.x + bounds.w - 22` 와 `bounds.x + bounds.w - 46` → x ∈ [bounds.x+174, bounds.x+214] 범위에서 폭 16 화분.
- 좌우 양옆 세로 벽은 인테리어상 비어있는 상태. 따라서 좌·우 벽에 테이블을 두는 것은 가능하지만, 소파(좌측, 도어쪽)와 화분(우측, 도어쪽)이 차지하는 도어 측 가로 스트립과 **세로 방향에서 분리**해야 한다.

도어 사이드 가로 스트립의 Y 범위:
- doorSide=bottom → 소파/화분 Y ≈ `bounds.y + bounds.h - 42 .. bounds.y + bounds.h - 12` (대략 마지막 30px). 따라서 테이블은 `bounds.y + 4 .. bounds.y + bounds.h - 50` (door 반대쪽) 영역을 사용.
- doorSide=top → 소파/화분 Y ≈ `bounds.y + 12 .. bounds.y + 40`. 테이블은 `bounds.y + 50 .. bounds.y + bounds.h - 4`.

---

## 설계 결정

### D1. 랩탑 수 / 방당 슬롯 수
- **방당 6대** (좌측 테이블 3 + 우측 테이블 3). 요구사항 본문 명시.
- 6 > 한 방의 일반적 동시 active 에이전트 수, 따라서 §D7 폴백은 거의 발생하지 않음.

### D2. 좌표 / 새 상수 (`constants.ts`에 추가)

```ts
// 랩탑 (책상 대체)
export const LAPTOP_W = 14;   // 닫힌 상태의 평면 가로 (top-down)
export const LAPTOP_H = 10;   // 닫힌 상태의 평면 세로 (table 두께 방향)
export const LAPTOP_OPEN_SCREEN_H = 12; // 열린 상태에서 화면이 위로 펼쳐지는 높이

// 방 좌우 벽 테이블
export const TABLE_THICKNESS = 16;  // 벽에서 안쪽으로 튀어나오는 두께
export const TABLE_INSET_FROM_WALL = 2; // 벽으로부터 안쪽 마진 (벽 두께 만큼)
export const LAPTOPS_PER_SIDE = 3;
export const LAPTOPS_PER_ROOM = LAPTOPS_PER_SIDE * 2;  // 6
```

`DESK_W = 44`, `DESK_H = 28` 상수는 **사용처 확인 후 제거**. Grep 결과:
- `DESK_W`/`DESK_H`는 import만 되어 있고 코드에서 직접 사용되지 않음 (drawDesk 함수가 자체적으로 `const w=44; const h=28;`을 사용). → **PixiApp.ts에서 import도 제거**.

`drawDesk` 함수 자체는 신규 `drawLaptop`으로 **교체**한다 (drawDesk export 삭제).

### D3. 테이블 + 랩탑 좌표 계산 공식 (방별)

`buildSlot()`에서 `bounds`(방 인테리어 박스), `doorSide`를 받아:

```ts
// Y 범위: 도어 반대쪽으로부터 시작
const tableTopMargin = 18;
const tableBottomMargin = 50; // 소파/화분 영역 회피
const tableY = doorSide === 'bottom'
  ? bounds.y + tableTopMargin
  : bounds.y + tableBottomMargin;
const tableLen = bounds.h - tableTopMargin - tableBottomMargin;

// 좌측 테이블: 벽에 붙음
const leftTableX = bounds.x + 2;          // 좌벽 두께 2 바로 옆
// 우측 테이블
const rightTableX = bounds.x + bounds.w - 2 - TABLE_THICKNESS;

// 랩탑 Y 좌표 (테이블 길이를 N등분, 각 칸의 중앙)
const cell = tableLen / LAPTOPS_PER_SIDE;
for (let i = 0; i < LAPTOPS_PER_SIDE; i++) {
  const cy = tableY + cell * i + cell / 2 - LAPTOP_H / 2;
  // 좌측 랩탑 X (테이블 안쪽 1px 마진)
  const lx = leftTableX + (TABLE_THICKNESS - LAPTOP_W) / 2;
  // 우측 랩탑 X
  const rx = rightTableX + (TABLE_THICKNESS - LAPTOP_W) / 2;
  // 캐릭터 stand 좌표:
  //   좌측: 테이블 우측 가장자리 + 작은 갭, 캐릭터 폭 16
  //   우측: 테이블 좌측 가장자리 - 캐릭터 폭 - 작은 갭
  const charY = cy + LAPTOP_H / 2 - 10; // 캐릭터 높이 20 → 중심 정렬
  const leftStand = { x: leftTableX + TABLE_THICKNESS + 2, y: charY };
  const rightStand = { x: rightTableX - 16 - 2, y: charY };
}
```

좌표 무결성 검증:
- ROOM_W=220, 벽 2 + 좌테이블 16 + 캐릭터 16 + 가용 공간 + 캐릭터 16 + 우테이블 16 + 벽 2 = 68 + 가용 = 220 → 방 가운데 가용 공간 152px. 충분.
- ROOM_H=225, 도어쪽 50px + 도어 반대쪽 18px + 테이블 길이 = 225 → 테이블 길이 157px. 3등분 → 칸당 ≈52px → 랩탑 + 캐릭터 위아래 여유 공간 충분.
- 소파 Y 충돌: doorSide=bottom 일 때 테이블 Y 범위 = `bounds.y+18 .. bounds.y+18+157 = bounds.y+175`. 소파 Y = `bounds.y + bounds.h - 42 = bounds.y+183`. 8px 여유 → OK.
- doorSide=top: 소파 Y = `bounds.y+18 .. bounds.y+40`. 테이블 Y = `bounds.y+50 .. bounds.y+207`. 10px 여유 → OK.
- 좌측 화분/소파 X 충돌: 좌측 테이블 X 범위 = `bounds.x+2 .. bounds.x+18`. 소파 X 시작 = `bounds.x+12` → 6px 겹침. 그러나 소파 Y 범위와 테이블 Y 범위는 §위에서 분리됨 → 시각적 겹침 없음.
- 우측 화분 X 충돌: 우측 테이블 X 범위 = `bounds.x+202 .. bounds.x+218`. 화분 우측 = `bounds.x+174 .. bounds.x+214` → X 겹침 있으나 Y 분리됨 → 시각적 충돌 없음.

### D4. 랩탑 그리기 함수 시그니처

`sprites.ts`에 신규 함수 두 개:

```ts
// 닫힌 랩탑: 위에서 본 얇은 평면
export function drawLaptopClosed(g: Graphics, x: number, y: number): void;

// 열린 랩탑: 베이스 + 위로 펼쳐진 화면 (점유 중)
export function drawLaptopOpen(g: Graphics, x: number, y: number): void;
```

PALETTE 추가:
```ts
laptopBody: 0x4a4a55,        // 랩탑 외피 (다크 그레이)
laptopBodyDark: 0x2a2a35,    // 외피 음영
laptopBezel: 0x1a1a22,       // 화면 베젤 (= 기존 monitor 색 재사용 가능, 별도 키 추가는 일관성 위해)
```
**필요 색상 결정**: 기존 `PALETTE.monitor` (0x1a1a22)를 베젤로 재사용하고, `PALETTE.monitorOn` (0x4fb3bf)을 화면 ON으로 재사용한다. 신규 추가는 `laptopBody`, `laptopBodyDark` 두 개만.

#### `drawLaptopClosed`
- 14×10 직사각형 본체 + 1px 음영
- 상단 가장자리에 1px 힌지 라인

#### `drawLaptopOpen`
- 베이스(키보드 면): 14×6 본체, 키보드 점 디테일 2~3px
- 화면: 베이스의 상단 변에 힌지로 붙어 위로 12px 펼쳐짐 → 14×12 베젤 + 12×10 ON 패널
- 색상: 본체 `PALETTE.laptopBody`, 베젤 `PALETTE.monitor`, 화면 `PALETTE.monitorOn`

#### 테이블 그리기
랩탑이 올라간 긴 테이블도 sprites.ts에 신규 함수:
```ts
// 세로 방향 긴 테이블 (벽에 붙는 형태)
export function drawSideTable(g: Graphics, x: number, y: number, w: number, h: number): void;
```
- 색상: `PALETTE.deskTop` 재사용 (테이블 상판), `PALETTE.desk` 다리/측면. 신규 PALETTE 색 추가 없음.

### D5. 점유 추적 자료구조

**방별 분리 매니저** — 6방 × 6랩탑 = 36슬롯을 단일 매니저로 합치면 매핑이 복잡해진다. 각 방마다 독립된 LaptopBank를 둔다.

```ts
// activity.ts 에 추가 (test 가능하도록 ActivityToken 기반)
export type LaptopSlotIndex = 0 | 1 | 2 | 3 | 4 | 5;

type LaptopSlotState = { index: LaptopSlotIndex; occupant: ActivityToken | null };

export class LaptopBank {
  private slots: LaptopSlotState[];
  constructor(slotCount: number) {
    this.slots = Array.from({ length: slotCount }, (_, i) => ({
      index: i as LaptopSlotIndex,
      occupant: null,
    }));
  }
  /** 빈 슬롯이 있으면 점유하고 인덱스 반환, 없으면 null */
  acquire(token: ActivityToken): LaptopSlotIndex | null;
  /** 해당 토큰이 점유한 슬롯 해제. 아니면 no-op */
  release(token: ActivityToken): void;
  /** 슬롯 점유자 (test introspection) */
  slotOccupant(index: LaptopSlotIndex): ActivityToken | null;
  /** 점유 중 슬롯 인덱스 (test/UI 렌더 용) */
  occupiedIndices(): LaptopSlotIndex[];
}
```

`acquire` 는 **가장 낮은 빈 인덱스**부터 채운다 (결정론적, 시각적 안정성).

`PixiApp.ts` 측에서는:
```ts
type RoomSlot = {
  ...
  laptopPositions: { x: number; y: number }[];        // 랩탑 본체 좌표 (drawLaptop용)
  laptopStandPositions: { x: number; y: number }[];   // 캐릭터 stand 좌표
  laptopBank: LaptopBank;                              // 신규
  laptopGfx: Graphics;                                 // 매 점유 변경 시 redraw
};
```

`activity.ts` 에 BathroomManager 옆에 LaptopBank를 추가하고, PixiApp.ts 도 import해서 사용. (PixiApp.ts에서 또 한 번 BathroomManager가 중복 정의되어 있는 패턴과 달리, LaptopBank는 단일 정의 — activity.ts) 한 곳에서만 정의하고 import).

### D6. 에이전트 → 랩탑 할당 알고리즘

`routeToDesk()`를 다음과 같이 변경:

```ts
const routeToDesk = () => {
  ch!.onActivityPreempt = undefined;
  ch!.tryStartActivity('work');
  const idx = room.laptopBank.acquire(ch!);
  if (idx === null) {
    // 폴백: 모든 랩탑 점유 → work 활동을 즉시 종료하고 wander로 복귀.
    // 실제로 한 방에 6명을 초과하는 케이스는 거의 없음.
    ch!.endActivity('work');
    ch!.pickWanderTarget();
    return;
  }
  // 슬롯 예약은 자료구조상만 잠금 (1:1 보장). 시각 토글은 하지 않음 —
  // 캐릭터가 도착해서 store가 working 상태로 승격한 후 sync 프레임에서
  // redrawRoomLaptops가 호출될 때 비로소 open으로 그려진다.
  ch!.assignedLaptop = { roomId: sid, index: idx };
  const stand = room.laptopStandPositions[idx];
  ch!.walkPath([room.approachInterior, stand], () => {
    if (ch!.state === 'walking_to_desk') {
      notifyArrivedAtDesk(sid, agentName);
      // 도착 직후 랩탑 시각 갱신. store가 이 틱에 working으로 승격하므로,
      // 동일 sync 프레임 내 후속 redrawRoomLaptops(room) 호출이 open을 그린다.
      redrawRoomLaptops(room);
    }
  });
};
```

> "슬롯 예약(acquire)"과 "시각 토글(open/closed)"을 분리한다. acquire는 자료구조상 1:1 점유만 보장하고, 시각적으로 열린 랩탑은 **캐릭터가 실제로 책상 앞에 도착해서 store가 `walking_to_desk → working`으로 승격한 뒤**에만 나타난다. 이는 직전 PR(`b90e210`)에서 도입한 "책상 도착 전엔 work 시각 효과를 보여주지 않는다" 정책과 일관된다. 판정은 순수 규칙: **슬롯에 occupant가 있고, 그 occupant의 state가 `working`일 때만 open**.

`Character` 클래스에 신규 필드:
```ts
// 현재 점유 중인 랩탑 (work 활동 동안만 유효)
assignedLaptop: { roomId: string; index: LaptopSlotIndex } | null = null;
```

### D7. 폴백 시나리오
- **모든 랩탑이 점유됨**: `acquire()`가 null 반환 → `endActivity('work')` 후 `pickWanderTarget()`. 다음 sync에서 자동 재시도되지 않으므로, store가 `walking_to_desk` 상태를 다음 tick에 다시 evaluate할 때까지 기다린다. **현재 일반적 사용 케이스에서 발생하지 않으므로 추가 재시도 로직은 두지 않는다** (요구사항: 불가능 시나리오 에러 핸들링 금지).

### D8. 랩탑 시각 상태 토글 (도착 시점 토글)

각 방의 `laptopGfx: Graphics`는 점유 변경 또는 캐릭터 상태 전이 시점에 전체를 다시 그린다. 매 프레임 redraw는 불필요. redraw 트리거 지점:
1. `buildSlot()` 초기화 (모두 닫힌 상태) — 방별 1회
2. `walkPath` 도착 콜백 (`notifyArrivedAtDesk` 발화 직후) — store가 `walking_to_desk → working`으로 승격한 동일 sync 프레임 안에서 호출하여 해당 슬롯이 open으로 갱신되도록 한다
3. `releaseLaptop()` (`endActivity('work')` 직전 새로 만드는 헬퍼)
4. 세션 종료 시 캐릭터 cull 루프 (`PixiApp.ts:1899~1909`)
5. stale character cleanup 루프 (`PixiApp.ts:2030~2036`)

**acquire 시점에는 redraw를 호출하지 않는다** — 예약된 슬롯은 여전히 closed로 그려진다. 이것이 핵심이다.

#### 슬롯 상태 판정 규칙 (순수 함수)

그리기는 다음 순수 규칙을 따른다:

```
shouldDrawOpen(slot) =
  slot.occupant !== null AND slot.occupant.state === 'working'
```

즉, **슬롯이 점유되어 있고 그 점유자의 캐릭터 state가 `working`** 일 때만 open으로 그린다. acquire는 됐지만 occupant가 아직 `walking_to_desk`인 경우 → closed. 이는 §D6에서 설명한 "자료구조 예약"과 "시각 토글"의 분리를 그리기 레벨에서 강제한다.

이 판정을 테스트 가능한 순수 함수로 `src/game/activity.ts`에 추출한다 (§테스트 계획 T10~ 참조):

```ts
// activity.ts
export interface LaptopVisualOccupant {
  state: 'idle' | 'walking_to_desk' | 'working' | 'walking_home' | string;
}
export function shouldDrawLaptopOpen(
  occupant: LaptopVisualOccupant | null
): boolean {
  return occupant !== null && occupant.state === 'working';
}
```

`LaptopBank`는 `slotOccupant(i)`로 점유자 토큰을 반환하는 API가 이미 있다. PixiApp은 그 토큰을 `Character`로 캐스팅하여 `state`를 읽고 위 함수에 넘긴다.

#### redraw 구현

```ts
function redrawRoomLaptops(room: RoomSlot): void {
  room.laptopGfx.clear();
  // 테이블 두 개 (drawSideTable)
  drawSideTable(room.laptopGfx, leftTableX, tableY, TABLE_THICKNESS, tableLen);
  drawSideTable(room.laptopGfx, rightTableX, tableY, TABLE_THICKNESS, tableLen);
  // 랩탑 6개 — 점유 여부가 아니라 "점유 + occupant.state === 'working'"
  for (let i = 0; i < room.laptopPositions.length; i++) {
    const { x, y } = room.laptopPositions[i];
    const occ = room.laptopBank.slotOccupant(i) as Character | null;
    if (shouldDrawLaptopOpen(occ)) {
      drawLaptopOpen(room.laptopGfx, x, y);
    } else {
      drawLaptopClosed(room.laptopGfx, x, y);
    }
  }
}
```

테이블 좌표는 매번 같으므로 두 부분으로 분리해도 무방 (테이블 정적 Graphics + 랩탑 동적 Graphics). 단순화를 위해 한 Graphics에서 매번 같이 그린다 (방마다 6+6=12 사각형 수준, 부담 없음).

### D9. release 트리거 통합

`releaseLaptop(ch)` 헬퍼를 sync 블록 가까이에 정의:
```ts
function releaseLaptop(ch: Character) {
  if (!ch.assignedLaptop) return;
  const room = rooms.get(ch.assignedLaptop.roomId);
  if (room) {
    room.laptopBank.release(ch);
    redrawRoomLaptops(room);
  }
  ch.assignedLaptop = null;
}
```

호출 지점:
- `PixiApp.ts:1992-1995` (`!becomingWorking && wasWorking`) → `ch.endActivity('work')` 직전에 `releaseLaptop(ch)` 호출 (close + 슬롯 해제)
- `PixiApp.ts:1899-1909` (세션 종료, 캐릭터 cull) → `bathroom.evict(ch)` 옆에 `releaseLaptop(ch)`
- stale character cleanup 루프 (`PixiApp.ts:2030-2036`) → destroy 직전에 `releaseLaptop(ch)`
- `routeToDesk()`의 폴백 분기에서도 — 단, acquire 실패 시점이라 점유가 없으므로 호출 불필요.

`redrawRoomLaptops(room)`는 release 시점(위)과 **도착 콜백 시점**(`routeToDesk` 내 `walkPath`의 `onComplete`) 두 경로에서 호출된다. acquire 시점(routeToDesk 진입)에는 호출하지 않는다.

---

## 변경 계획

### F1. `src/game/constants.ts`

- **삭제**: `DESK_W`, `DESK_H`
- **추가**: `LAPTOP_W`, `LAPTOP_H`, `LAPTOP_OPEN_SCREEN_H`, `TABLE_THICKNESS`, `LAPTOPS_PER_SIDE`, `LAPTOPS_PER_ROOM` — §D2 참조
- `PALETTE`에 `laptopBody: 0x4a4a55`, `laptopBodyDark: 0x2a2a35` 추가. 기존 키 변경 없음.

### F2. `src/game/sprites.ts`

- **삭제**: `drawDesk` (export 자체 제거)
- **추가**: `drawLaptopClosed(g, x, y)`, `drawLaptopOpen(g, x, y)`, `drawSideTable(g, x, y, w, h)`

#### `drawLaptopClosed` 픽셀 명세 (14×10)
```
g.rect(x, y + 1, 14, 9).fill(PALETTE.laptopBodyDark);   // 그림자
g.rect(x, y, 14, 9).fill(PALETTE.laptopBody);            // 몸체
g.rect(x, y, 14, 1).fill(PALETTE.laptopBezel /* = monitor */);  // 힌지 라인
g.rect(x + 1, y + 8, 12, 1).fill(PALETTE.laptopBodyDark); // 바닥 음영
```

#### `drawLaptopOpen` 픽셀 명세 (베이스 14×6, 화면 위로 12px)
```
const screenH = LAPTOP_OPEN_SCREEN_H; // 12
// 화면 (위)
g.rect(x, y - screenH, 14, screenH).fill(PALETTE.monitor);   // 베젤
g.rect(x + 1, y - screenH + 1, 12, screenH - 2).fill(PALETTE.monitorOn);  // ON 패널
// 힌지
g.rect(x, y - 1, 14, 1).fill(PALETTE.laptopBodyDark);
// 베이스 (키보드)
g.rect(x, y, 14, 6).fill(PALETTE.laptopBody);
g.rect(x + 1, y + 5, 12, 1).fill(PALETTE.laptopBodyDark);
// 키보드 점 (3×2 도트)
for (let kx = 0; kx < 3; kx++) {
  for (let ky = 0; ky < 2; ky++) {
    g.rect(x + 3 + kx * 4, y + 1 + ky * 2, 2, 1).fill(PALETTE.laptopBodyDark);
  }
}
```

#### `drawSideTable(g, x, y, w, h)`
```
// 그림자 (안쪽 1px)
g.rect(x + 1, y + 1, w, h).fill(0x2a1a10);
// 상판
g.rect(x, y, w, h).fill(PALETTE.deskTop);
// 가장자리 음영
g.rect(x, y, 1, h).fill(PALETTE.desk);
g.rect(x, y + h - 1, w, 1).fill(PALETTE.desk);
g.rect(x + w - 1, y, 1, h).fill(PALETTE.desk);
```

### F3. `src/game/activity.ts`

- **추가**: `LaptopSlotIndex`, `LaptopSlotState` 타입, `LaptopBank` 클래스 — §D5 시그니처

```ts
export type LaptopSlotIndex = number;  // 단순화: number, 0..slotCount-1

type LaptopSlotState = { index: LaptopSlotIndex; occupant: ActivityToken | null };

export class LaptopBank {
  private slots: LaptopSlotState[];

  constructor(slotCount: number) {
    this.slots = [];
    for (let i = 0; i < slotCount; i++) {
      this.slots.push({ index: i, occupant: null });
    }
  }

  acquire(token: ActivityToken): LaptopSlotIndex | null {
    // 이미 같은 토큰이 점유한 슬롯이 있으면 그 인덱스 반환 (중복 acquire 안전)
    const existing = this.slots.find((s) => s.occupant === token);
    if (existing) return existing.index;
    const free = this.slots.find((s) => s.occupant === null);
    if (!free) return null;
    free.occupant = token;
    return free.index;
  }

  release(token: ActivityToken): void {
    const slot = this.slots.find((s) => s.occupant === token);
    if (slot) slot.occupant = null;
  }

  slotOccupant(index: LaptopSlotIndex): ActivityToken | null {
    return this.slots[index]?.occupant ?? null;
  }

  occupiedIndices(): LaptopSlotIndex[] {
    return this.slots.filter((s) => s.occupant !== null).map((s) => s.index);
  }

  /** test introspection */
  slotCount(): number {
    return this.slots.length;
  }
}
```

### F4. `src/game/PixiApp.ts`

#### F4-a. import 변경
- `DESK_W`, `DESK_H` import 제거 (현재 import되지 않음 — 확인됨, 변경 없음)
- `drawDesk` import 제거, `drawLaptopClosed`, `drawLaptopOpen`, `drawSideTable` import 추가
- `constants`에서 `LAPTOPS_PER_SIDE`, `LAPTOPS_PER_ROOM`, `LAPTOP_W`, `LAPTOP_H`, `TABLE_THICKNESS` import 추가
- `activity` 모듈에서 `LaptopBank`, `LaptopSlotIndex` import 추가

#### F4-b. `RoomSlot` 타입 변경 (`PixiApp.ts:1384-1403`)
- **삭제**: `deskPositions: { x: number; y: number }[];`
- **추가**:
  ```ts
  laptopPositions: { x: number; y: number }[];
  laptopStandPositions: { x: number; y: number }[];
  laptopBank: LaptopBank;
  laptopGfx: Graphics;
  ```

#### F4-c. `Character` 클래스 신규 필드 (`PixiApp.ts:113~`)
- 추가: `assignedLaptop: { roomId: string; index: LaptopSlotIndex } | null = null;`

#### F4-d. `buildSlot()` 변경 (`PixiApp.ts:1707-1831`)
**old (1719-1733)**:
```ts
// Desks along the non-door long wall
const deskFx = new Graphics();
const deskPositions: ...
const deskSpacing = 62;
const deskCount = 3;
const deskRowW = ...
const startX = ...
const deskY = ...
for (let i = 0; i < deskCount; i++) { drawDesk(...); deskPositions.push(...); }
container.addChild(deskFx);
```

**new**:
```ts
// Side-wall tables with laptops along non-door long walls.
const laptopGfx = new Graphics();
const laptopPositions: { x: number; y: number }[] = [];
const laptopStandPositions: { x: number; y: number }[] = [];

const tableTopMargin = 18;
const tableBottomMargin = 50;
const tableY = doorSide === 'bottom'
  ? bounds.y + tableTopMargin
  : bounds.y + tableBottomMargin;
const tableLen = bounds.h - tableTopMargin - tableBottomMargin;
const leftTableX = bounds.x + 2;
const rightTableX = bounds.x + bounds.w - 2 - TABLE_THICKNESS;

const cell = tableLen / LAPTOPS_PER_SIDE;
for (let i = 0; i < LAPTOPS_PER_SIDE; i++) {
  const cy = tableY + cell * i + cell / 2 - LAPTOP_H / 2;
  // 좌측 랩탑
  const lx = leftTableX + Math.floor((TABLE_THICKNESS - LAPTOP_W) / 2);
  laptopPositions.push({ x: lx, y: cy });
  laptopStandPositions.push({
    x: leftTableX + TABLE_THICKNESS + 2,
    y: cy + LAPTOP_H / 2 - 10,
  });
}
for (let i = 0; i < LAPTOPS_PER_SIDE; i++) {
  const cy = tableY + cell * i + cell / 2 - LAPTOP_H / 2;
  const rx = rightTableX + Math.floor((TABLE_THICKNESS - LAPTOP_W) / 2);
  laptopPositions.push({ x: rx, y: cy });
  laptopStandPositions.push({
    x: rightTableX - 16 - 2,
    y: cy + LAPTOP_H / 2 - 10,
  });
}

const laptopBank = new LaptopBank(LAPTOPS_PER_ROOM);
container.addChild(laptopGfx);
```

`return` 객체에 `laptopPositions`, `laptopStandPositions`, `laptopBank`, `laptopGfx` 추가, `deskPositions` 제거.

initial draw: `buildSlot()` 끝(또는 `buildStaticOffice`의 `for (let i...) slots.push(...)` 직후)에서 모든 방에 대해 `redrawRoomLaptops(room)` 1회 호출하여 closed 상태로 그린다.

#### F4-e. `deskFor` 함수 제거 (`PixiApp.ts:1870-1878`)
완전히 삭제. `stableIndex`는 `colorIdx` 결정 등에서 여전히 사용되므로 유지 (`PixiApp.ts:1931` 참조).

#### F4-f. 신규 헬퍼 `redrawRoomLaptops(room)` 추가
`buildSlot` 직전 또는 `buildStaticOffice` 위에 정의:
```ts
function redrawRoomLaptops(room: RoomSlot): void {
  room.laptopGfx.clear();
  // 테이블 두 개 — 좌표 재계산
  const tableTopMargin = 18;
  const tableBottomMargin = 50;
  const tableY = room.doorSide === 'bottom'
    ? room.bounds.y + tableTopMargin
    : room.bounds.y + tableBottomMargin;
  const tableLen = room.bounds.h - tableTopMargin - tableBottomMargin;
  const leftTableX = room.bounds.x + 2;
  const rightTableX = room.bounds.x + room.bounds.w - 2 - TABLE_THICKNESS;
  drawSideTable(room.laptopGfx, leftTableX, tableY, TABLE_THICKNESS, tableLen);
  drawSideTable(room.laptopGfx, rightTableX, tableY, TABLE_THICKNESS, tableLen);
  // 랩탑
  const occupied = new Set(room.laptopBank.occupiedIndices());
  for (let i = 0; i < room.laptopPositions.length; i++) {
    const { x, y } = room.laptopPositions[i];
    if (occupied.has(i)) {
      drawLaptopOpen(room.laptopGfx, x, y);
    } else {
      drawLaptopClosed(room.laptopGfx, x, y);
    }
  }
}
```

(테이블 좌표 상수가 buildSlot과 redrawRoomLaptops 두 곳에 중복되는 것은 작은 코드 중복이지만, 별도 헬퍼로 추출해서 둘 다 호출하는 것을 권장 — implementer 판단 — :  `function computeTableLayout(room): { tableY, tableLen, leftTableX, rightTableX }`. plan 단계에서는 두 번 등장한다고 명시.)

#### F4-g. 신규 헬퍼 `releaseLaptop(ch)` 추가
sync 블록 위쪽에 정의:
```ts
function releaseLaptop(ch: Character): void {
  if (!ch.assignedLaptop) return;
  const room = rooms.get(ch.assignedLaptop.roomId);
  if (room) {
    room.laptopBank.release(ch);
    redrawRoomLaptops(room);
  }
  ch.assignedLaptop = null;
}
```

#### F4-h. `routeToDesk` 변경 (`PixiApp.ts:1975-1986`)
```ts
const routeToDesk = () => {
  ch!.onActivityPreempt = undefined;
  ch!.tryStartActivity('work');
  // 안전망: 이전 슬롯이 남아 있었다면 먼저 해제 (no-op 보장)
  releaseLaptop(ch!);
  const idx = room.laptopBank.acquire(ch!);
  if (idx === null) {
    // 폴백: 빈 랩탑 없음 → work 포기, wander로 복귀
    ch!.endActivity('work');
    ch!.pickWanderTarget();
    return;
  }
  ch!.assignedLaptop = { roomId: sid, index: idx };
  // 여기서는 redrawRoomLaptops를 호출하지 않는다.
  // 랩탑은 캐릭터가 도착해서 working으로 승격한 시점에만 open으로 그려진다.
  const stand = room.laptopStandPositions[idx];
  ch!.walkPath([room.approachInterior, stand], () => {
    if (ch!.state === 'walking_to_desk') {
      notifyArrivedAtDesk(sid, agentName);
      // store는 이 틱에서 walking_to_desk → working으로 승격한다.
      // 동일 sync 프레임 내에서 redraw를 호출해 해당 슬롯을 open으로 그린다.
      redrawRoomLaptops(room);
    }
  });
};
```

#### F4-i. work 종료 분기에 release 끼우기 (`PixiApp.ts:1992-1995`)
```ts
} else if (!becomingWorking && wasWorking) {
  releaseLaptop(ch);              // ← 추가
  ch.endActivity('work');
  ch.pickWanderTarget();
}
```

#### F4-j. 세션 종료 cull에 release 끼우기 (`PixiApp.ts:1899-1909`)
```ts
for (const [key, ch] of characters) {
  if (key.startsWith(sid + ':')) {
    releaseLaptop(ch);             // ← 추가
    bathroom.evict(ch);
    ch.container.destroy({ children: true });
    characters.delete(key);
  }
}
```

또한 sync 블록 끝의 stale character 제거 루프 (`PixiApp.ts:2030-2036`)에도 release 추가:
```ts
for (const [key, ch] of characters) {
  if (!seenChars.has(key)) {
    releaseLaptop(ch);             // ← 추가
    ch.container.destroy({ children: true });
    characters.delete(key);
  }
}
```

#### F4-k. `buildStaticOffice` 직후 모든 방 초기 redraw
```ts
for (let i = 0; i < OFFICE_SLOTS; i++) {
  slots.push(buildSlot(i));
}
for (const s of slots) redrawRoomLaptops(s);
```

(또는 `buildSlot` 내부 끝에서 한 번 호출 — implementer 선택)

### F5. `src/game/sprites.ts` 외 영향
- `drawDesk` 사용처 grep → PixiApp.ts:27 import만 존재 (확인). 다른 곳에서 안 씀. 안전하게 export 제거 가능.

---

## 테스트 계획

`src/game/activity.test.ts`에 신규 describe 블록 추가. 기존 BathroomManager / ActivitySlot 테스트는 영향 없음.

### T1. `LaptopBank.acquire — empty bank`
- `new LaptopBank(6)` 후 첫 토큰이 인덱스 0 받는지
- 두 번째 토큰이 인덱스 1 받는지 (가장 낮은 빈 인덱스)
- 6번째 토큰까지 모두 0..5 순서로 받는지

### T2. `LaptopBank.acquire — full bank`
- 6개 다 점유 상태에서 7번째 토큰이 `null` 반환하는지

### T3. `LaptopBank.acquire — 1:1 점유 보장 (핵심 회귀 방지)`
- 토큰 A acquire → 인덱스 0
- 토큰 B acquire → 인덱스 1 (NOT 0)
- A가 점유한 슬롯에 다른 토큰이 들어가지 못함을 검증

### T4. `LaptopBank.acquire — 동일 토큰 중복 acquire`
- 같은 토큰을 두 번 acquire → 같은 인덱스 반환, 슬롯 사용량 1로 유지

### T5. `LaptopBank.release`
- 점유한 토큰 release → `slotOccupant(idx) === null`
- release 후 다른 토큰이 같은 슬롯 acquire 가능 (가장 낮은 빈 인덱스 규칙에 따라)
- 점유 안 한 토큰 release → no-op (예외 던지지 않음)

### T6. `LaptopBank.release — 다른 슬롯 영향 없음`
- A→0, B→1, C→2 acquire 후 B release → A, C 슬롯 그대로

### T7. `LaptopBank.occupiedIndices`
- 비어있을 때 빈 배열
- A, C, E acquire (1, 3, 5는 비어있음) 시퀀스 후 정확한 인덱스 집합 반환

### T8. `LaptopBank — 6개 점유 후 1개 release → acquire 시 해당 인덱스 받음`
- 회귀 시나리오: 0..5 점유 → 슬롯 2 release → 새 토큰 acquire → 인덱스 2 받음

### T9. `LaptopBank — 두 매니저는 독립`
- mgr1, mgr2 두 개 만들고 mgr1에 acquire한 토큰이 mgr2에 영향 안 끼침

### T10. `shouldDrawLaptopOpen — null occupant → closed`
- `shouldDrawLaptopOpen(null) === false`
- 위치: `src/game/activity.ts`에 `export function shouldDrawLaptopOpen(occupant: { state: string } | null): boolean` 추가. 테스트는 `src/game/activity.test.ts`에 신규 describe 블록.

### T11. `shouldDrawLaptopOpen — walking_to_desk 점유자 → closed`
- acquire는 됐으나 아직 도착 전인 캐릭터를 표현: `{ state: 'walking_to_desk' }`
- `shouldDrawLaptopOpen({ state: 'walking_to_desk' }) === false`
- 이 테스트가 본 변경의 핵심 회귀 방지다: "acquire 직후엔 랩탑이 닫힌 상태로 그려진다"는 요구사항을 순수 함수 레벨에서 고정한다.

### T12. `shouldDrawLaptopOpen — working 점유자 → open`
- `shouldDrawLaptopOpen({ state: 'working' }) === true`
- "도착 후 working으로 승격하면 open으로 그려진다" 요구사항의 순수 함수 검증.

### T13. `shouldDrawLaptopOpen — 기타 state → closed`
- `idle`, `walking_home` 등 그 외 상태에 대해 모두 `false`
- 방어적: 향후 state가 추가되어도 명시적으로 `working`일 때만 open.

> PixiApp.ts 측의 redraw / routeToDesk / release wiring(Graphics 호출, Character 상태 전이, walkPath onComplete)은 pixi 의존성 때문에 단위 테스트 불가. 그리기 결정(open/closed)은 §T10~T13의 순수 함수 `shouldDrawLaptopOpen`으로 격리해 단위 테스트하고, 호출 타이밍(도착 콜백 안쪽에서 redrawRoomLaptops가 불리는지)은 수동/시각 검증한다. LaptopBank 자체의 점유 1:1 회귀 방지는 §T1~T9가 담당.

---

## 영향 범위 / 리스크

### 회귀 가능성

1. **store 측 영향 없음** — `agent-arrived-at-desk` 이벤트는 그대로 `walkPath` 콜백에서 발사됨. store 코드 무변경. 기존 `store.test.ts`의 walking_to_desk 관련 테스트들도 무변경 통과해야 함.

2. **bathroom / pingpong / meeting 영향 없음** — 점유 매니저는 별개. RoomSlot 타입에서 `deskPositions`가 사라지지만, meeting/bathroom/pingpong은 `deskPositions`를 참조하지 않음 (Grep 확인됨).

3. **mainWanderZone / subWanderZone** — wander zone 좌표는 그대로 유지. 단, sub-agent wander zone (`subWanderZone`)이 couch 영역에 묶여있어 새 테이블과 충돌하지 않음 (couch는 도어 측, 테이블은 도어 반대쪽 측면).

4. **카메라 / OFFICE_W / OFFICE_H** — 변경 금지 항목. 영향 없음.

5. **DESK_W / DESK_H 제거** — 다른 사용처 없음 (Grep 확인). 안전.

### 잠재 리스크

1. **테이블 Y 범위와 소파/화분의 겹침** — §D3에서 좌표를 분리 검증했으나, 현재 `couchY` 계산이 `bounds.y + bounds.h - 42` 또는 `bounds.y + 18`이라 doorSide 별로 다르다. 테이블 마진 (top 18 / bottom 50)도 doorSide에 맞춰 swap 되어야 함을 implementer가 정확히 구현해야 한다. 본 plan 코드 스니펫이 이미 `doorSide === 'bottom'` 분기를 명시하고 있으므로 그대로 옮길 것.

2. **도착 시점 토글의 한 프레임 깜빡임 가능성** — 랩탑은 "도착 시점"에 open으로 전환된다 (§D6, §D8). 구체적으로, `walkPath` `onComplete` 내부에서 `notifyArrivedAtDesk(sid, agentName)` → `redrawRoomLaptops(room)` 순으로 호출한다. store는 `agent-arrived-at-desk` 이벤트를 동기 리듀스하여 그 캐릭터의 state를 `walking_to_desk → working`으로 승격한 뒤, 다음 `sync` 호출(PixiApp 쪽에서 SSE 수신 직후 또는 동일 프레임 내)에서 캐릭터 상태 변경이 반영된다. redraw는 store 갱신 직후에 호출되므로 `shouldDrawLaptopOpen`이 `working`을 관찰하여 open을 그린다. **따라서 동일 틱 안에서 close → open 전환이 일어나 사용자 관점에서 깜빡임 없음**. 검증 필요: store의 `agent-arrived-at-desk` 핸들러가 동기(즉시 state를 `working`으로 set)임을 plan 단계에서 확인했다 (`src/store.ts`의 이벤트 리듀서, `walking_to_desk → working` 전이). 비동기 네트워크 경로가 끼지 않음. 만약 reviewer 단계에서 "도착 직후 한 프레임 closed로 그려진 뒤 다음 프레임 open" 현상이 관측되면 fallback: `redrawRoomLaptops`를 `setTimeout(0)` 혹은 다음 ticker 콜백에서 한 번 더 호출. 단, 이 추가는 implementer의 설계 판단 금지 원칙에 걸리므로 reviewer가 구체 재시도 지시를 내릴 때만 수행.

   또한 "acquire는 됐으나 도착 전"인 시간 동안 다른 에이전트가 같은 슬롯을 뺏어가지 못하는 1:1 보장은 자료구조(LaptopBank) 수준에서 그대로 유지된다. 즉 이 변경은 **자료구조 점유(acquire 즉시) / 시각 토글(도착 시점)의 분리**이며, 점유 정확성은 희생하지 않는다.

3. **work 활동이 preempt 되지 않는다는 가정** — `routeToDesk`에서 `ch.onActivityPreempt = undefined`로 두는 것은 work가 최고 우선순위(4)이기 때문에 선점 불가 (`ACTIVITY_PRIORITY`, activity.ts:17-24). 따라서 acquire 후 release 누락 위험은 §F4-i, F4-j 두 분기로만 한정됨. 이 두 분기 + 신규 stale character cleanup 분기를 모두 wiring해야 함.

4. **routeToDesk가 새 walking_to_desk 진입 시마다 acquire 호출** — 같은 `ch`가 work를 끊었다가 다시 시작하면 `assignedLaptop = null` 상태이므로 새 슬롯을 받게 된다. 만약 release 누락으로 이전 슬롯이 stuck되면 영구 점유 발생. → 위 §F4-i에서 항상 release를 우선 호출하므로 안전. 추가 안전망으로 `routeToDesk` 진입 시점에 `releaseLaptop(ch)`를 한 번 호출해도 무방 (no-op 보장됨). implementer 권장.

5. **방당 LaptopBank의 슬롯 수가 6으로 고정** — §D1 결정에 따라 `LAPTOPS_PER_ROOM = 6`. 향후 변경하려면 constants.ts만 수정하면 됨 (LaptopBank constructor에 변수로 전달).

### 폴백 시나리오 (acquire 실패)
- 한 방의 active 에이전트 수가 6을 초과하는 비정상 케이스에서만 발생. `routeToDesk`는 `endActivity('work') + pickWanderTarget()`으로 종료. 에이전트는 idle wander로 돌아가며, 다음 store sync에서 state가 여전히 `walking_to_desk` 또는 `working`이면 routeToDesk가 다시 호출되며 재시도. 무한 루프는 store 쪽 state가 외부 이벤트 없이 자동 복구되지 않으므로 발생하지 않음. **이 시나리오가 실제로 일어나면 시각적으로 "캐릭터가 work 상태인데 데스크에 가지 못함"이 관찰되므로, 운영자가 인지 가능.** 추가 알림은 요구사항 외이므로 미구현.
