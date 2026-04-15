# 구현 계획: map-vertical-1_5x

## 접근 방식

사용자의 의도는 "가로가 너무 길다, 세로만 약 1.5배 늘려 정사각형 쪽으로"이다.
`src/game/constants.ts`의 `ROOM_H`와 `CORRIDOR_H` 두 상수만 1.5배로 확대하면
`OFFICE_H`가 파생 계산식(`OFFICE_ROWS * ROOM_H + CORRIDOR_H + OFFICE_MARGIN * 2`)을
통해 자동으로 1.47배가 된다. 가로 관련 상수(`ROOM_W`, `FACILITY_W`, `OFFICE_MARGIN`,
`DESK_W`, `OFFICE_W`)는 절대 건드리지 않는다. 다른 파일은 모두 이 상수들을 참조만 할 뿐
하드코딩된 세로 매직 넘버가 없어, 상수 변경만으로 레이아웃·카메라·피트가 전파된다.

## 조사 요약 (판단 근거)

1. **세로 의미 상수 식별** — `src/game/constants.ts`에서 세로 의미를 가진 상수:
   - `ROOM_H = 150` ← 변경 대상
   - `CORRIDOR_H = 64` ← 변경 대상
   - `OFFICE_H` ← 파생 계산식, 직접 수정 X (자동 갱신됨)
   - `OFFICE_MARGIN = 10` ← **변경 X** (가로/세로 공용 margin. 세로만 건드리는 요구와 상충)
   - `DESK_H = 28` ← **변경 X** (책상 세로이지만, 아래 탐색 결과 어디서도 import/사용되지 않음. 죽은 상수. 본 요청 범위 밖)

2. **연쇄 영향 — grep 결과 (`ROOM_H|CORRIDOR_H|OFFICE_H|DESK_H|OFFICE_MARGIN`)**
   - `src/game/constants.ts` (정의부)
   - `src/game/PixiApp.ts` 만이 실제 소비자. 다음 위치에서 참조:
     - line 1446: `const sh = OFFICE_H * currentScale;` — 카메라 레이아웃 (자동 갱신)
     - line 1460: `const sy = ch / OFFICE_H;` — 핏 스케일 계산 (자동 갱신)
     - line 1488: `y: OFFICE_MARGIN + ROOM_H,` — corridor 상단 (자동 갱신)
     - line 1490: `h: CORRIDOR_H,` — corridor 높이 (자동 갱신)
     - line 1501, 1507: bathroom/pingpong y (자동 갱신)
     - line 1503, 1509: bathroom/pingpong h = CORRIDOR_H (자동 갱신)
     - line 1601: `y: row === 0 ? OFFICE_MARGIN : OFFICE_MARGIN + ROOM_H + CORRIDOR_H,` — slot row 배치 (자동 갱신)
     - line 1602: `h: ROOM_H` — slot bounds (자동 갱신)
     - line 1607: `h: OFFICE_H - OFFICE_MARGIN * 2` — 오피스 배경 (자동 갱신)
     - line 1614, 1620, 1626, 1632: `h: ROOM_H` — 4개 outdoor patch (자동 갱신)
     - line 1618, 1630: `y: OFFICE_MARGIN + ROOM_H + CORRIDOR_H,` — 하단 outdoor patch (자동 갱신)
   - `src/game/sprites.ts`: 세로 상수 import 없음 (`PALETTE`만 import). 캐릭터는 16x20 고정.
   - `src/game/activity.ts`: 크기/좌표 상수 미사용 (역할 토큰/우선순위 로직만).
   - `src/game/activity.test.ts`: 크기/좌표 상수 미사용.

3. **하드코딩 매직 넘버 검사** — `src/game/PixiApp.ts`에서 `\b150\b|\b64\b|\b384\b` 검색
   결과 **0건**. 모든 세로값이 상수로만 쓰임. 추가 보정 불필요.

4. **HTML/Vite/App.tsx 캔버스 크기 제약 검사**
   - `index.html`: `html, body, #root { height: 100% }`, `overflow: hidden`, 캔버스는
     `image-rendering: pixelated`만 지정. 크기 제약 없음.
   - `vite.config.ts`: 프록시만. 크기 무관.
   - `src/App.tsx`: 호스트 div가 `position: absolute, inset: 0`로 가용 영역 전체 차지.
     우측 `DetailPanel`은 `width: 340` 고정(가로). Pixi는 `resizeTo: host` + `fitScaleToHost()`로
     뷰포트에 맞게 스케일을 스냅 다운하므로, `OFFICE_H`가 커져도 자동 피트된다.
   - **결론: HTML/CSS/Vite 쪽 변경 없음. 잘림 없음.**

5. **테스트 영향**: `src/game/activity.test.ts`는 좌표/크기 상수에 의존하지 않는다
   (ACTIVITY_PRIORITY, BathroomManager 로직만 테스트). **기대값 갱신 없음.**

6. **bathroomDwellSpots(line 1512~1527) 재검토** — `bathroomBounds.h`(=CORRIDOR_H)를 사용해
   스탠스톨 y를 중앙 정렬한다. `CORRIDOR_H`가 64 → 96으로 늘면 stallYStart도 자동으로
   내려가 중앙 정렬이 유지됨. 별도 조치 불필요.

## Task 목록

### Task 1: 세로 상수 1.5배 확대

#### 대상 파일
- `src/game/constants.ts` (기존 파일, 2줄 수정)

#### 변경 내용 (old → new)

**line 10:**
```
export const ROOM_H = 150;
```
→
```
export const ROOM_H = 225;
```

**line 11:**
```
export const CORRIDOR_H = 64;
```
→
```
export const CORRIDOR_H = 96;
```

#### 계산 검증
- 변경 후 `OFFICE_H = 2 * 225 + 96 + 10 * 2 = 566`
- 기존 `OFFICE_H = 2 * 150 + 64 + 10 * 2 = 384`
- 비율: 566 / 384 ≈ **1.474x** ("약 1.5배" 요구 충족)
- `ROOM_H` 배율: 225 / 150 = 1.5
- `CORRIDOR_H` 배율: 96 / 64 = 1.5
- 가로 `OFFICE_W`: 수식상 세로 상수 무관 → **불변**

#### 구현 로직
1. `src/game/constants.ts`를 연다.
2. line 10의 `ROOM_H = 150`을 `ROOM_H = 225`로 바꾼다.
3. line 11의 `CORRIDOR_H = 64`를 `CORRIDOR_H = 96`으로 바꾼다.
4. 다른 줄은 **절대 건드리지 않는다**. 특히:
   - `ROOM_W`, `FACILITY_W`, `DOOR_W`, `OFFICE_MARGIN`, `DESK_W`, `DESK_H` 유지
   - `OFFICE_W`, `OFFICE_H` 표현식 자체는 유지(파생이므로 자동 갱신)
   - `PALETTE`, `AGENT_COLORS` 유지

#### 참고 코드
- 파생식 위치: `src/game/constants.ts:21-22`
- 소비처 대표: `src/game/PixiApp.ts:1601` (slot row y 계산)

#### 성공 기준
- `npx tsc --noEmit` 통과 (타입/계산식 모두 정상)
- `npm run dev` 기동 후 브라우저에서:
  - 오피스 세로가 이전 대비 약 1.47배로 시각적으로 늘어남
  - 가로는 이전과 동일
  - 복도·방·화장실·탁구장 경계가 깨지지 않음 (자동 파생 덕분)
  - 캐릭터 spawn/walk/화장실 대기열이 새 좌표계에서 정상 동작
  - 초기 `fitScaleToHost()`가 호출되어 세로 확장 후에도 전체 맵이 창에 수용됨 (스케일만 조금 더 낮게 스냅됨)

## Task 순서

Step 1: Task 1 (단일 파일, 2줄 수정)

병렬화 없음. 단일 태스크.

## 하지 않는 것

- 가로 상수(`ROOM_W`, `FACILITY_W`, `DOOR_W`, `DESK_W`, `OFFICE_W`) 변경 금지
- `OFFICE_MARGIN` 변경 금지 (가로/세로 공용 — 세로만 늘리는 요구와 상충)
- `DESK_H` 변경 금지 (현재 코드에서 미사용 죽은 상수, 본 요청 범위 밖)
- `OFFICE_H` 수식 변경 금지 (파생식이므로 상수 변경이 자동 전파됨)
- `PALETTE`, `AGENT_COLORS` 등 비관련 상수 변경 금지
- `src/game/PixiApp.ts`, `src/game/sprites.ts`, `src/game/activity.ts`, `index.html`,
  `vite.config.ts`, `src/App.tsx` 등 어떤 다른 파일도 수정 금지
  (조사 결과 세로 확장에 연쇄적으로 고쳐야 할 하드코딩 값이 없음)
- 테스트 기대값 갱신 없음 (`activity.test.ts`는 좌표/크기 미의존)
- 종횡비 비례 스케일 금지
- 인접 코드 리팩터/정리/네이밍 개선 금지
