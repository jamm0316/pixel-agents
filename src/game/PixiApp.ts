import {
  Application,
  Container,
  Graphics,
  Text,
  TextStyle,
} from 'pixi.js';
import {
  SCALE,
  ROOM_W,
  ROOM_H,
  CORRIDOR_H,
  DOOR_W,
  FACILITY_W,
  OFFICE_COLS,
  OFFICE_ROWS,
  OFFICE_SLOTS,
  OFFICE_MARGIN,
  OFFICE_W,
  OFFICE_H,
  PALETTE,
  WALK_SPEED,
  AGENT_COLORS,
} from './constants';
import {
  drawCharacter,
  drawDesk,
  drawCouch,
  drawPlant,
  drawRoomFloor,
  drawRoomWalls,
  drawCorridorFloor,
  drawOfficeBackground,
  drawRoomDimOverlay,
  drawBathroom,
  drawPingPong,
  drawOutdoorPatch,
} from './sprites';
import {
  formatIntent,
  formatHandoff,
  parseHandoffTarget,
  formatPermissionQuestion,
  randomChatter,
  randomBathroomLine,
  randomBathroomDwellLine,
  randomPingPongInvite,
  randomPingPongAccept,
  randomPingPongRally,
} from './korean';
import type { SessionInfo, AgentUiState, PermissionRequest } from '../types';

type SelectPayload = { sessionId: string; agentName: string } | null;
type Rect = { x: number; y: number; w: number; h: number };
type BubbleKind = 'tool' | 'chatter' | 'speech' | 'permission';
type BubbleState = 'hidden' | 'fade-in' | 'typing' | 'hold' | 'permission' | 'fade-out';
type PermissionChoice = (requestId: string, decision: 'allow' | 'deny' | 'always') => void;

type ActivityKind = 'work' | 'meeting' | 'pingpong' | 'toilet' | 'chatter' | 'wander';

const ACTIVITY_PRIORITY: Record<ActivityKind, number> = {
  work: 4,
  meeting: 3,
  pingpong: 3,
  toilet: 2,
  chatter: 1,
  wander: 0,
};

const CHARS_PER_SEC = 30;
const HOLD_MS = 2000;
const FADE_IN_PER_SEC = 8;   // alpha gain per second
const FADE_OUT_PER_SEC = 5;

function makeBtn(
  label: string,
  w: number,
  h: number,
  fg: number,
  bg: number,
  onTap: () => void
): Container {
  const c = new Container();
  const g = new Graphics();
  g.roundRect(0, 0, w, h, 3).fill(bg).stroke({ color: 0x1a1a22, width: 1 });
  c.addChild(g);
  const t = new Text({
    text: label,
    style: new TextStyle({
      fontFamily: 'monospace',
      fontSize: 8,
      fontWeight: 'bold',
      fill: fg,
    }),
  });
  t.anchor.set(0.5, 0.5);
  t.x = w / 2;
  t.y = h / 2 + 0.5;
  c.addChild(t);
  c.eventMode = 'static';
  c.cursor = 'pointer';
  c.hitArea = { contains: (x: number, y: number) => x >= 0 && x <= w && y >= 0 && y <= h } as any;
  c.on('pointertap', (e: any) => {
    e?.stopPropagation?.();
    onTap();
  });
  c.on('pointerdown', (e: any) => {
    e?.stopPropagation?.();
  });
  return c;
}

class Character {
  container = new Container();
  body = new Graphics();
  label: Text;
  ring = new Graphics();

  // Bubble visuals
  bubble = new Container();
  bubbleBg = new Graphics();
  bubbleText: Text;
  bubbleButtons: Container[] = [];

  // Position / animation
  targetX = 0;
  targetY = 0;
  path: { x: number; y: number }[] = [];
  frame = 0;
  walkCounter = 0;
  idleCounter = 0;
  state: AgentUiState['state'] = 'idle';
  colors = AGENT_COLORS[0];
  selected = false;
  wanderZone: Rect | null = null;
  corridorExcursion: { approachInterior: { x: number; y: number }; approachCorridor: { x: number; y: number }; corridorZone: Rect } | null = null;
  facilities: FacilityInfo[] = [];
  wanderDwell = 0;
  wanderTimer = 0;

  private bathroomManager: BathroomManager | null = null;

  setBathroomManager(m: BathroomManager): void {
    this.bathroomManager = m;
  }

  // Bubble state machine
  bubbleState: BubbleState = 'hidden';
  bubbleKind: BubbleKind | null = null;
  bubbleFullText = '';
  bubbleDisplayedChars = 0;
  bubbleTypeElapsed = 0;
  bubbleHoldElapsed = 0;
  bubbleCurrentId: string | null = null;
  bubbleLastRenderedLen = -1;
  bubbleAlpha = 0;

  // Chatter
  chatterTimer = 5 + Math.random() * 15;

  // Meeting / facility
  inMeeting = false;
  inPingPong = false;
  inBathroom = false;

  // Activity slot — single source of truth for what the character is doing.
  // Replaces direct mutation of inMeeting / inPingPong / inBathroom from outside.
  currentActivity: ActivityKind | null = null;

  // Hook called when a higher-priority activity preempts the current one.
  // Set by whoever started the activity (manager or character itself).
  onActivityPreempt: ((preemptedBy: ActivityKind) => void) | undefined;

  // Dwell (stationary pause with optional callback)
  dwellTimer = 0;
  dwellOnComplete: (() => void) | undefined;

  // Fires once when a walkPath reaches its final waypoint
  pathOnComplete: (() => void) | undefined;

  // Permission callback
  onPermissionChoice?: PermissionChoice;

  constructor(
    public agentName: string,
    colorIdx: number,
    onSelect: () => void,
    onPermissionChoice: PermissionChoice
  ) {
    this.colors = AGENT_COLORS[colorIdx % AGENT_COLORS.length];
    this.onPermissionChoice = onPermissionChoice;
    drawCharacter(this.body, this.colors, 0);
    this.container.addChild(this.ring);
    this.container.addChild(this.body);

    this.label = new Text({
      text: agentName,
      style: new TextStyle({
        fontFamily: 'monospace',
        fontSize: 8,
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 2 },
      }),
    });
    this.label.anchor.set(0.5, 1);
    this.label.x = 8;
    this.label.y = -1;
    this.container.addChild(this.label);

    this.bubbleText = new Text({
      text: '',
      style: new TextStyle({
        fontFamily: 'monospace',
        fontSize: 8,
        fill: 0x1a1a22,
        wordWrap: true,
        wordWrapWidth: 140,
        lineHeight: 10,
      }),
    });
    this.bubbleText.x = 6;
    this.bubbleText.y = 4;
    this.bubble.addChild(this.bubbleBg);
    this.bubble.addChild(this.bubbleText);
    this.bubble.visible = false;
    this.container.addChild(this.bubble);

    this.container.eventMode = 'static';
    this.container.cursor = 'pointer';
    this.container.on('pointertap', onSelect);
    this.container.hitArea = {
      contains: (x: number, y: number) => x >= 0 && x <= 16 && y >= 0 && y <= 20,
    } as any;
  }

  setPosition(x: number, y: number) {
    this.container.x = x;
    this.container.y = y;
    this.targetX = x;
    this.targetY = y;
  }

  walkTo(x: number, y: number) {
    this.path = [];
    this.targetX = x;
    this.targetY = y;
    this.pathOnComplete = undefined;
    this.dwellTimer = 0;
    this.dwellOnComplete = undefined;
  }

  walkPath(points: { x: number; y: number }[], onComplete?: () => void) {
    if (!points.length) return;
    this.path = points.slice(1);
    this.targetX = points[0].x;
    this.targetY = points[0].y;
    this.pathOnComplete = onComplete;
    this.dwellTimer = 0;
    this.dwellOnComplete = undefined;
  }

  startDwell(seconds: number, onComplete?: () => void) {
    this.dwellTimer = seconds;
    this.dwellOnComplete = onComplete;
    this.path = [];
    this.pathOnComplete = undefined;
  }

  setWanderZone(zone: Rect | null) {
    this.wanderZone = zone;
  }

  setCorridorExcursion(
    ex: {
      approachInterior: { x: number; y: number };
      approachCorridor: { x: number; y: number };
      corridorZone: Rect;
    } | null
  ) {
    this.corridorExcursion = ex;
  }

  setFacilities(fs: FacilityInfo[]) {
    this.facilities = fs;
  }

  pickWanderTarget() {
    if (!this.wanderZone) return;
    const z = this.wanderZone;
    const canExcursion = this.corridorExcursion && this.currentActivity === null;
    // Only the bathroom is a solo excursion — ping-pong must be initiated by the PingPongManager
    // (2+ players required), so we never pick it as a solo wander.
    const bathroom = canExcursion
      ? this.facilities.find((f) => f.name === 'toilet') ?? null
      : null;

    const roll = Math.random();
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

      // Wire preempt BEFORE requesting a slot so that preempt handling
      // is already in place.
      this.onActivityPreempt = (_by) => {
        mgr.evict(this);
      };

      // Reusable helper: what to do once we physically arrive at a urinal
      // (either immediately assigned, or later promoted from the queue).
      const onArriveAtUrinal = () => {
        this.saySpeech(randomBathroomDwellLine());
        // facing system not present — visual remains idle frame
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
            // Arrived at wait spot. Stand idle facing the bathroom door.
            // facing system not present — visual remains idle frame
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

    if (canExcursion && roll < 0.22) {
      if (!this.tryStartActivity('wander')) {
        // Some higher-priority activity is running — skip.
        return;
      }
      const ex = this.corridorExcursion!;
      const cz = ex.corridorZone;
      const cx = cz.x + Math.random() * cz.w;
      const cy = cz.y + Math.random() * cz.h;
      const back = { x: z.x + Math.random() * z.w, y: z.y + Math.random() * z.h };
      this.walkPath(
        [ex.approachInterior, ex.approachCorridor, { x: cx, y: cy }, ex.approachCorridor, ex.approachInterior, back],
        () => {
          this.endActivity('wander');
        }
      );
      this.wanderDwell = 4 + Math.random() * 3;
      this.wanderTimer = 0;
      return;
    }

    // Plain in-room wander — also a 'wander' activity but very short.
    // We don't try to claim the slot for plain wander because it would
    // constantly conflict with chatter; instead, plain wander is the
    // "no activity" baseline and skips the slot entirely.
    this.walkTo(z.x + Math.random() * z.w, z.y + Math.random() * z.h);
    this.wanderDwell = 1.5 + Math.random() * 4;
    this.wanderTimer = 0;
  }

  // --- Bubble API ---

  sayTool(tool: string, summary: string) {
    const text = formatIntent(tool, summary);
    const id = `tool:${tool}:${summary}`;
    if (this.bubbleCurrentId === id && this.bubbleState !== 'hidden') return;
    this.startBubble(id, text, 'tool');
  }

  sayHandoff(target: string, summary: string) {
    const text = formatHandoff(target);
    const id = `handoff:${target}:${summary}`;
    if (this.bubbleCurrentId === id && this.bubbleState !== 'hidden') return;
    this.startBubble(id, text, 'speech');
  }

  sayChatter() {
    const text = randomChatter();
    const id = `chatter:${Date.now()}:${text}`;
    this.startBubble(id, text, 'chatter');
  }

  saySpeech(text: string) {
    const id = `speech:${Date.now()}:${Math.random()}`;
    this.startBubble(id, text, 'speech');
  }

  showPermission(req: PermissionRequest) {
    const id = `perm:${req.requestId}`;
    if (this.bubbleCurrentId === id) return;
    const question = formatPermissionQuestion(req.tool, req.inputSummary);
    const detail = req.inputSummary
      ? `${question}\n${truncateText(req.inputSummary, 26)}`
      : question;
    this.startPermissionBubble(id, detail, req.requestId);
  }

  clearBubbleIfNotPermission() {
    if (this.bubbleKind === 'permission') return;
    this.hideBubble();
  }

  clearBubble() {
    this.startFadeOut();
  }

  private startBubble(id: string, text: string, kind: BubbleKind) {
    this.clearButtons();
    this.bubbleCurrentId = id;
    this.bubbleKind = kind;
    this.bubbleState = 'fade-in';
    this.bubbleFullText = text;
    this.bubbleDisplayedChars = 0;
    this.bubbleTypeElapsed = 0;
    this.bubbleHoldElapsed = 0;
    this.bubbleLastRenderedLen = -1;
    this.bubbleAlpha = 0;
    this.bubble.alpha = 0;
    this.bubbleText.text = '';
    this.bubble.visible = true;
    this.drawBubbleBg(0, 0);
  }

  private startPermissionBubble(id: string, text: string, requestId: string) {
    this.clearButtons();
    this.bubbleCurrentId = id;
    this.bubbleKind = 'permission';
    this.bubbleState = 'fade-in';
    this.bubbleFullText = text;
    this.bubbleDisplayedChars = 0;
    this.bubbleTypeElapsed = 0;
    this.bubbleHoldElapsed = 0;
    this.bubbleLastRenderedLen = -1;
    this.bubbleAlpha = 0;
    this.bubble.alpha = 0;
    this.bubbleText.text = '';
    this.bubble.visible = true;

    // Create buttons — handlers also clear the bubble (fade-out) immediately on click
    const make = (decision: 'allow' | 'deny' | 'always') => () => {
      this.onPermissionChoice?.(requestId, decision);
      this.startFadeOut();
    };

    const btnAllow = makeBtn('수락', 32, 14, 0x0e3a1f, 0xb8e8c3, make('allow'));
    const btnAlways = makeBtn('항상', 32, 14, 0x07323a, 0xb8dfe5, make('always'));
    const btnDeny = makeBtn('거부', 32, 14, 0x3a0e0e, 0xf5b8b8, make('deny'));
    this.bubbleButtons = [btnAllow, btnAlways, btnDeny];
    for (const b of this.bubbleButtons) this.bubble.addChild(b);
  }

  private clearButtons() {
    for (const b of this.bubbleButtons) {
      this.bubble.removeChild(b);
      b.destroy({ children: true });
    }
    this.bubbleButtons = [];
  }

  private startFadeOut() {
    if (this.bubbleState === 'hidden' || this.bubbleState === 'fade-out') return;
    this.bubbleState = 'fade-out';
  }

  private hideBubble() {
    this.clearButtons();
    this.bubble.visible = false;
    this.bubble.alpha = 0;
    this.bubbleAlpha = 0;
    this.bubbleState = 'hidden';
    this.bubbleKind = null;
    this.bubbleCurrentId = null;
    this.bubbleFullText = '';
    this.bubbleDisplayedChars = 0;
    this.bubbleLastRenderedLen = -1;
  }

  private drawBubbleBg(textW: number, textH: number) {
    const padX = 6;
    const padY = 4;
    const hasButtons = this.bubbleKind === 'permission';
    const buttonsH = hasButtons ? 16 : 0;

    const w = Math.max(40, textW + padX * 2);
    const h = textH + padY * 2 + buttonsH;

    this.bubbleBg.clear();
    // Shadow
    this.bubbleBg.roundRect(1, 1, w, h, 3).fill({ color: 0x000000, alpha: 0.3 });
    // White bubble
    this.bubbleBg
      .roundRect(0, 0, w, h, 3)
      .fill(0xffffff)
      .stroke({ color: 0x1a1a22, width: 1 });
    // Tail pointing down
    this.bubbleBg
      .moveTo(w / 2 - 3, h)
      .lineTo(w / 2, h + 4)
      .lineTo(w / 2 + 3, h)
      .lineTo(w / 2 - 3, h)
      .fill(0xffffff);
    this.bubbleBg
      .moveTo(w / 2 - 3, h)
      .lineTo(w / 2, h + 4)
      .stroke({ color: 0x1a1a22, width: 1 });
    this.bubbleBg
      .moveTo(w / 2, h + 4)
      .lineTo(w / 2 + 3, h)
      .stroke({ color: 0x1a1a22, width: 1 });

    // Position permission buttons
    if (hasButtons && this.bubbleButtons.length === 3) {
      const gap = 2;
      const btnW = 30;
      const totalW = btnW * 3 + gap * 2;
      const baseX = (w - totalW) / 2;
      const btnY = h - buttonsH + 2;
      for (let i = 0; i < 3; i++) {
        this.bubbleButtons[i].x = baseX + i * (btnW + gap);
        this.bubbleButtons[i].y = btnY;
      }
    }

    // Center horizontally above character (character head is at x≈8)
    this.bubble.x = 8 - w / 2;
    this.bubble.y = -h - 6;
  }

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
    this.inMeeting = kind === 'meeting';
    this.inPingPong = kind === 'pingpong';
    this.inBathroom = kind === 'toilet';
  }

  setSelected(sel: boolean) {
    this.selected = sel;
    this.ring.clear();
    if (sel) {
      this.ring.ellipse(8, 20, 9, 3).fill({ color: 0xffd84a, alpha: 0.9 });
      this.ring.ellipse(8, 20, 7, 2).fill({ color: 0xfff7a0, alpha: 0.5 });
    } else {
      this.ring.ellipse(8, 20, 7, 2).fill({ color: 0x000000, alpha: 0.25 });
    }
  }

  tick(dt: number) {
    let walking = false;

    if (this.dwellTimer > 0) {
      // Stationary pause — don't consume path or move
      this.dwellTimer -= dt;
      if (this.dwellTimer <= 0) {
        this.dwellTimer = 0;
        const cb = this.dwellOnComplete;
        this.dwellOnComplete = undefined;
        cb?.();
      }
    } else {
      // Movement
      const dx = this.targetX - this.container.x;
      const dy = this.targetY - this.container.y;
      const dist = Math.hypot(dx, dy);
      const step = WALK_SPEED * dt;

      if (dist > 0.5) {
        walking = true;
        const r = Math.min(1, step / dist);
        this.container.x += dx * r;
        this.container.y += dy * r;
      } else if (this.path.length > 0) {
        const next = this.path.shift()!;
        this.targetX = next.x;
        this.targetY = next.y;
        walking = true;
      } else if (this.pathOnComplete) {
        const cb = this.pathOnComplete;
        this.pathOnComplete = undefined;
        cb();
      }
    }

    // Wander (suppressed when any exclusive activity is running)
    if (
      !walking &&
      this.dwellTimer <= 0 &&
      this.state === 'idle' &&
      this.wanderZone &&
      this.currentActivity === null &&
      !this.inMeeting
    ) {
      this.wanderTimer += dt;
      if (this.wanderTimer >= this.wanderDwell) {
        this.pickWanderTarget();
      }
    }

    // Bubble state machine
    if (this.bubbleState === 'fade-in') {
      this.bubbleAlpha = Math.min(1, this.bubbleAlpha + dt * FADE_IN_PER_SEC);
      this.bubble.alpha = this.bubbleAlpha;
      if (this.bubbleAlpha >= 1) {
        this.bubbleState = 'typing';
      }
      // Type a few chars even during fade-in for snappier feel
      this.bubbleTypeElapsed += dt;
      const tc = Math.floor(this.bubbleTypeElapsed * CHARS_PER_SEC);
      if (tc !== this.bubbleDisplayedChars) {
        this.bubbleDisplayedChars = Math.min(tc, this.bubbleFullText.length);
        this.renderBubbleIfDirty();
      }
    } else if (this.bubbleState === 'typing') {
      this.bubbleTypeElapsed += dt;
      const targetChars = Math.floor(this.bubbleTypeElapsed * CHARS_PER_SEC);
      if (targetChars >= this.bubbleFullText.length) {
        this.bubbleDisplayedChars = this.bubbleFullText.length;
        this.bubbleState = this.bubbleKind === 'permission' ? 'permission' : 'hold';
        this.bubbleHoldElapsed = 0;
      } else {
        this.bubbleDisplayedChars = targetChars;
      }
      this.renderBubbleIfDirty();
    } else if (this.bubbleState === 'hold') {
      this.bubbleHoldElapsed += dt * 1000;
      if (this.bubbleHoldElapsed >= HOLD_MS) {
        this.startFadeOut();
      }
    } else if (this.bubbleState === 'fade-out') {
      this.bubbleAlpha = Math.max(0, this.bubbleAlpha - dt * FADE_OUT_PER_SEC);
      this.bubble.alpha = this.bubbleAlpha;
      if (this.bubbleAlpha <= 0) {
        this.hideBubble();
      }
    }
    // permission: stays visible until user clicks or external clear (with full alpha)

    // Random chatter: only when bubble is hidden, idle, and not in any exclusive activity
    if (
      this.bubbleState === 'hidden' &&
      this.state === 'idle' &&
      this.currentActivity === null &&
      !this.inMeeting
    ) {
      this.chatterTimer -= dt;
      if (this.chatterTimer <= 0) {
        this.sayChatter();
        this.chatterTimer = 12 + Math.random() * 30;
      }
    }

    // Frame animation
    let newFrame: number;
    if (walking) {
      this.walkCounter += dt * 8;
      newFrame = 2 + (Math.floor(this.walkCounter) % 2);
    } else if (this.inPingPong) {
      // Swing arms while playing — reuse walk frames
      this.walkCounter += dt * 12;
      newFrame = 2 + (Math.floor(this.walkCounter) % 2);
    } else if (this.state === 'working') {
      this.walkCounter += dt * 8;
      newFrame = 4 + (Math.floor(this.walkCounter) % 2);
    } else {
      this.idleCounter += dt;
      newFrame = Math.floor(this.idleCounter * 1.5) % 2 === 0 ? 0 : 1;
    }
    if (newFrame !== this.frame) {
      this.frame = newFrame;
      drawCharacter(this.body, this.colors, this.frame);
    }
  }

  private renderBubbleIfDirty() {
    if (this.bubbleDisplayedChars === this.bubbleLastRenderedLen) return;
    this.bubbleLastRenderedLen = this.bubbleDisplayedChars;
    const shown = this.bubbleFullText.slice(0, this.bubbleDisplayedChars);
    this.bubbleText.text = shown;
    // In Pixi v8, .width and .height reflect layout after setting text
    const tw = this.bubbleText.width || 0;
    const th = this.bubbleText.height || 10;
    this.drawBubbleBg(tw, th);
  }
}

function truncateText(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// ---- Meetings ----

const DIALOGUES: string[][] = [
  ['이번 릴리즈 언제지?', '금요일이래', '야근각이네...'],
  ['점심 뭐 먹을까?', '오늘은 김밥 어때', '난 다이어트 중이야'],
  ['회의 너무 많지 않아?', '코딩할 시간이 없어', '내일도 또 회의야'],
  ['커피 한 잔 어때?', '좋지', '나도 같이 가자'],
  ['주말에 뭐 했어?', '집에서 잤어', '나도 푹 쉬었어'],
  ['스프린트 끝나면 회식?', '치킨 ㄱㄱ', '맥주도'],
  ['리뷰 끝났어?', '아직 코멘트 다는 중', '도와줄까?'],
  ['새 라이브러리 봤어?', '그거 좀 별로던데', '다른 거 추천해줘'],
  ['배포 잘 됐어?', '응 무사히', '다행이다'],
  ['QA 통과했어?', '버그 두 개 더 있대', '아이고...'],
  ['오늘 너무 졸리다', '나도 커피 한 잔 더', '점심 후 식곤증'],
  ['프로젝트 마감이 언제더라', '다음 주 수요일', '아직 멀었네'],
];

type MeetingPhase = 'gather' | 'talk' | 'done';

type Meeting = {
  roomId: string;
  attendees: Character[];
  attendeeHomeWanderZones: (Rect | null)[];
  spot: { x: number; y: number };
  phase: MeetingPhase;
  script: string[];
  scriptIndex: number;
  scriptTimer: number;
  gatherTimer: number;
};

class MeetingManager {
  private meetings: Meeting[] = [];
  private nextTry = 6 + Math.random() * 8;

  update(dt: number, rooms: Map<string, RoomSlot>, characters: Map<string, Character>) {
    this.nextTry -= dt;
    if (this.nextTry <= 0) {
      this.nextTry = 12 + Math.random() * 18;
      this.maybeStart(rooms, characters);
    }

    for (const m of this.meetings) {
      this.tickMeeting(m, dt);
    }
    if (this.meetings.some((m) => m.phase === 'done')) {
      this.meetings = this.meetings.filter((m) => m.phase !== 'done');
    }
  }

  private maybeStart(rooms: Map<string, RoomSlot>, characters: Map<string, Character>) {
    if (Math.random() > 0.55) return;

    const roomEntries = [...rooms.entries()];
    shuffle(roomEntries);

    for (const [sid, room] of roomEntries) {
      if (this.meetings.some((m) => m.roomId === sid)) continue;
      const idleHere: Character[] = [];
      for (const [k, c] of characters) {
        if (!k.startsWith(sid + ':')) continue;
        if (c.state !== 'idle') continue;
        if (c.inMeeting) continue;
        if (c.currentActivity !== null) continue; // skip pingpong / toilet / wander-excursion / work
        idleHere.push(c);
      }
      if (idleHere.length < 2) continue;

      shuffle(idleHere);
      const wantCount = Math.min(idleHere.length, 2 + Math.floor(Math.random() * 2));
      const attendees = idleHere.slice(0, wantCount);

      const spot = {
        x: room.subWanderZone.x + room.subWanderZone.w / 2,
        y: room.subWanderZone.y + room.subWanderZone.h / 2,
      };

      const homeZones: (Rect | null)[] = [];

      const accepted = attendees.every((c) => {
        c.onActivityPreempt = (_by) => {
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

      const script = DIALOGUES[Math.floor(Math.random() * DIALOGUES.length)];
      this.meetings.push({
        roomId: sid,
        attendees,
        attendeeHomeWanderZones: homeZones,
        spot,
        phase: 'gather',
        script,
        scriptIndex: 0,
        scriptTimer: 0,
        gatherTimer: 0,
      });
      return;
    }
  }

  private tickMeeting(m: Meeting, dt: number) {
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

    if (m.phase === 'gather') {
      m.gatherTimer += dt;
      const allArrived = m.attendees.every((c) => {
        const dx = c.targetX - c.container.x;
        const dy = c.targetY - c.container.y;
        return Math.hypot(dx, dy) < 1.5;
      });
      if (allArrived || m.gatherTimer > 6) {
        m.phase = 'talk';
        m.scriptTimer = 0.4;
      }
    } else if (m.phase === 'talk') {
      m.scriptTimer -= dt;
      if (m.scriptTimer <= 0) {
        if (m.scriptIndex >= m.script.length) {
          // End meeting: release attendees
          for (const c of m.attendees) {
            c.endActivity('meeting');
            c.pickWanderTarget();
          }
          m.phase = 'done';
        } else {
          const speakerIdx = m.scriptIndex % m.attendees.length;
          const line = m.script[m.scriptIndex];
          m.attendees[speakerIdx].saySpeech(line);
          m.scriptIndex++;
          m.scriptTimer = 1.8 + Math.random() * 0.6;
        }
      }
    }
  }
}

function shuffle<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ---- Bathroom ----

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

// ---- Ping-pong ----

type PingPongPhase = 'walking' | 'playing';

type PingPongAttendee = {
  character: Character;
  home: {
    approachInterior: { x: number; y: number };
    approachCorridor: { x: number; y: number };
    wanderZone: Rect;
  };
  spot: { x: number; y: number };
};

type PingPongGame = {
  phase: PingPongPhase;
  attendees: PingPongAttendee[];
  phaseTimer: number;
  ball: Graphics;
  ballX: number;
  ballVx: number;
  ballPhase: number;
  rallyCooldown: number;
};

const PINGPONG_PLAY_SECONDS = 15;

class PingPongManager {
  private game: PingPongGame | null = null;
  private nextTry = 20 + Math.random() * 20;

  update(
    dt: number,
    rooms: Map<string, RoomSlot>,
    characters: Map<string, Character>,
    facility: FacilityInfo,
    layer: Container
  ) {
    if (!this.game) {
      this.nextTry -= dt;
      if (this.nextTry <= 0) {
        this.nextTry = 25 + Math.random() * 30;
        this.tryStart(rooms, characters, facility, layer);
      }
      return;
    }
    this.tickGame(dt, facility);
  }

  private tryStart(
    rooms: Map<string, RoomSlot>,
    characters: Map<string, Character>,
    facility: FacilityInfo,
    layer: Container
  ) {
    // Gather eligible idle characters from lit rooms
    const candidates: PingPongAttendee[] = [];
    for (const [key, ch] of characters) {
      if (ch.container.destroyed) continue;
      if (ch.state !== 'idle') continue;
      if (ch.currentActivity !== null) continue;
      if (!ch.wanderZone) continue;
      const sid = key.split(':')[0];
      const room = rooms.get(sid);
      if (!room) continue;
      candidates.push({
        character: ch,
        home: {
          approachInterior: room.approachInterior,
          approachCorridor: room.approachCorridor,
          wanderZone: ch.wanderZone,
        },
        spot: { x: 0, y: 0 },
      });
    }
    if (candidates.length < 2) return;

    shuffle(candidates);
    const picked = candidates.slice(0, 2);

    // Table spots (left / right of the net)
    const pb = facility.bounds;
    const tw = Math.min(pb.w - 24, 56);
    const th = 22;
    const tx = pb.x + (pb.w - tw) / 2;
    const ty = pb.y + (pb.h - th) / 2;
    const leftSpot = { x: tx - 14, y: ty + 1 };
    const rightSpot = { x: tx + tw - 2, y: ty + 1 };
    picked[0].spot = leftSpot;
    picked[1].spot = rightSpot;

    // Dispatch them
    picked[0].character.saySpeech(randomPingPongInvite());
    picked[1].character.saySpeech(randomPingPongAccept());

    // Try to claim both characters atomically. If either refuses, abort
    // the match before assigning any walk paths.
    const accepted = picked.every((a) => {
      // Set preempt hook BEFORE tryStartActivity so it's wired even if
      // another activity preempts pingpong on the next tick.
      a.character.onActivityPreempt = (_by) => {
        // Preempted by something higher (only 'work' beats pingpong).
        // Stop the ball, send everyone else home, abandon the game.
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

    // Ball (created now, hidden until playing phase)
    const ball = new Graphics();
    ball.rect(0, 0, 2, 2).fill(0xf5f5f5);
    ball.visible = false;
    ball.x = tx + tw / 2;
    ball.y = ty + th / 2 - 1;
    layer.addChild(ball);

    this.game = {
      phase: 'walking',
      attendees: picked,
      phaseTimer: 0,
      ball,
      ballX: tx + tw / 2,
      ballVx: 24, // world units per second
      ballPhase: 0,
      rallyCooldown: 3 + Math.random() * 3,
    };
  }

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

  private cleanup() {
    if (!this.game) return;
    if (!this.game.ball.destroyed) this.game.ball.destroy();
    this.game = null;
    this.nextTry = 30 + Math.random() * 30;
  }

  private randomHomeTarget(a: PingPongAttendee) {
    return {
      x: a.home.wanderZone.x + Math.random() * a.home.wanderZone.w,
      y: a.home.wanderZone.y + Math.random() * a.home.wanderZone.h,
    };
  }

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

  private tickGame(dt: number, facility: FacilityInfo) {
    const g = this.game!;

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

    if (g.phase === 'walking') {
      const allArrived = g.attendees.every((a) => {
        const dx = a.spot.x - a.character.container.x;
        const dy = a.spot.y - a.character.container.y;
        return Math.hypot(dx, dy) < 1.5;
      });
      g.phaseTimer += dt;
      if (allArrived) {
        g.phase = 'playing';
        g.phaseTimer = 0;
        g.ball.visible = true;
      } else if (g.phaseTimer > 25) {
        // Took too long — abandon the match, send them home.
        for (const a of g.attendees) this.sendHome(a, facility);
        this.cleanup();
      }
      return;
    }

    // phase === 'playing'
    g.phaseTimer += dt;

    const pb = facility.bounds;
    const tw = Math.min(pb.w - 24, 56);
    const th = 22;
    const tx = pb.x + (pb.w - tw) / 2;
    const ty = pb.y + (pb.h - th) / 2;
    const ballXMin = tx + 4;
    const ballXMax = tx + tw - 6;

    g.ballX += g.ballVx * dt;
    if (g.ballX <= ballXMin) {
      g.ballX = ballXMin;
      g.ballVx = Math.abs(g.ballVx);
    } else if (g.ballX >= ballXMax) {
      g.ballX = ballXMax;
      g.ballVx = -Math.abs(g.ballVx);
    }
    g.ballPhase += dt * 9;
    g.ball.x = Math.round(g.ballX);
    g.ball.y = Math.round(ty + th / 2 - 1 - Math.abs(Math.sin(g.ballPhase)) * 3);

    g.rallyCooldown -= dt;
    if (g.rallyCooldown <= 0) {
      const speaker = g.attendees[Math.floor(Math.random() * g.attendees.length)].character;
      speaker.saySpeech(randomPingPongRally());
      g.rallyCooldown = 3 + Math.random() * 3;
    }

    if (g.phaseTimer >= PINGPONG_PLAY_SECONDS) {
      for (const a of g.attendees) this.sendHome(a, facility);
      this.cleanup();
    }
  }
}

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

// Fixed per the design: 2 urinal slots, one per stall.
// Indices match `bathroomDwellSpots` (the array built around the IIFE).
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

type RoomSlot = {
  slotIndex: number;
  row: 0 | 1;
  col: number;
  bounds: Rect; // room interior incl. walls, world coords
  container: Container; // holds dim overlay + signboard only (walls/floor/furniture drawn on shared layers)
  deskPositions: { x: number; y: number }[];
  idlePositions: { x: number; y: number }[];
  mainWanderZone: Rect;
  subWanderZone: Rect;
  doorSide: 'top' | 'bottom';
  doorWorldX: number;
  approachInterior: { x: number; y: number };
  approachCorridor: { x: number; y: number };
  signContainer: Container;
  signText: Text;
  signBg: Graphics;
  dimOverlay: Graphics;
  session: SessionInfo | null;
};

export type PixiAppHandle = {
  app: Application;
  canvas: HTMLCanvasElement;
  sync(
    sessions: SessionInfo[],
    agents: Map<string, AgentUiState>,
    pending: Map<string, PermissionRequest>
  ): void;
  onSelect(fn: (sel: SelectPayload) => void): void;
  onPermissionChoice(fn: PermissionChoice): void;
  onAgentArrivedAtDesk(fn: (sessionId: string, agentName: string) => void): void;
  setSelected(sel: SelectPayload): void;
  zoomIn(): void;
  zoomOut(): void;
  getZoom(): number;
  destroy(): void;
};

const MIN_SCALE = 0.5;
const MAX_SCALE = 4;
const ZOOM_STEP = 0.25;

export async function createPixiApp(host: HTMLElement): Promise<PixiAppHandle> {
  const app = new Application();
  await app.init({
    background: PALETTE.bg,
    antialias: false,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
    resizeTo: host,
  });
  host.appendChild(app.canvas);
  (app.canvas.style as any).imageRendering = 'pixelated';

  const world = new Container();
  app.stage.addChild(world);

  // --- Zoom / layout ---
  let currentScale = SCALE;
  function applyLayout() {
    world.scale.set(currentScale);
    const sw = OFFICE_W * currentScale;
    const sh = OFFICE_H * currentScale;
    const cw = app.screen.width;
    const ch = app.screen.height;
    world.x = sw < cw ? Math.round((cw - sw) / 2) : 0;
    world.y = sh < ch ? Math.round((ch - sh) / 2) : 0;
  }
  function snapScale(s: number) {
    return Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.round(s / ZOOM_STEP) * ZOOM_STEP));
  }
  function fitScaleToHost(): number {
    const cw = app.screen.width;
    const ch = app.screen.height;
    if (!cw || !ch) return SCALE;
    const sx = cw / OFFICE_W;
    const sy = ch / OFFICE_H;
    // Snap down to a clean ZOOM_STEP so the whole office fits
    const raw = Math.min(sx, sy);
    return Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.floor(raw / ZOOM_STEP) * ZOOM_STEP));
  }
  // Respond to canvas resize (resizeTo: host)
  app.renderer.on('resize', () => applyLayout());

  // Layer order (back → front):
  //   bgLayer (office floor + corridor)
  //   roomsLayer (walls, furniture, per-slot dim overlays, signboards)
  //   charactersLayer (all agents, world coords — free to roam between rooms/corridor)
  const bgLayer = new Container();
  const roomsLayer = new Container();
  const charactersLayer = new Container();
  world.addChild(bgLayer);
  world.addChild(roomsLayer);
  world.addChild(charactersLayer);

  const slots: RoomSlot[] = [];
  const rooms = new Map<string, RoomSlot>();
  const characters = new Map<string, Character>();
  let selected: SelectPayload = null;
  const selectListeners = new Set<(sel: SelectPayload) => void>();
  const permissionListeners = new Set<PermissionChoice>();
  const arrivedListeners = new Set<(sessionId: string, agentName: string) => void>();

  const corridorBounds: Rect = {
    x: OFFICE_MARGIN + FACILITY_W,
    y: OFFICE_MARGIN + ROOM_H,
    w: OFFICE_COLS * ROOM_W,
    h: CORRIDOR_H,
  };
  const corridorWanderZone: Rect = {
    x: corridorBounds.x + 8,
    y: corridorBounds.y + 10,
    w: corridorBounds.w - 16,
    h: corridorBounds.h - 20,
  };

  const bathroomBounds: Rect = {
    x: OFFICE_MARGIN,
    y: OFFICE_MARGIN + ROOM_H,
    w: FACILITY_W,
    h: CORRIDOR_H,
  };
  const pingpongBounds: Rect = {
    x: OFFICE_MARGIN + FACILITY_W + OFFICE_COLS * ROOM_W,
    y: OFFICE_MARGIN + ROOM_H,
    w: FACILITY_W,
    h: CORRIDOR_H,
  };

  const bathroomDwellSpots = (() => {
    // Mirrors the stall layout in drawBathroom so characters stand next to each toilet.
    const stallCount = 2;
    const stallH = 22;
    const stallMarginX = 6;
    const stallX = bathroomBounds.x + stallMarginX;
    const stallSpan = stallH * stallCount + (stallCount - 1) * 3;
    const stallYStart = bathroomBounds.y + (bathroomBounds.h - stallSpan) / 2;
    const spots: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < stallCount; i++) {
      const sy = stallYStart + i * (stallH + 3);
      // Character sprite is 16×20; place it so its center lines up with the stall
      spots.push({ x: stallX - 2, y: sy + stallH / 2 - 10 });
    }
    return spots;
  })();

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

  const facilities: FacilityInfo[] = [
    {
      name: 'toilet',
      label: '화장실',
      bounds: bathroomBounds,
      doorSide: 'right',
      interiorZone: {
        x: bathroomBounds.x + 8,
        y: bathroomBounds.y + 10,
        w: bathroomBounds.w - 24,
        h: bathroomBounds.h - 20,
      },
      approachInterior: {
        x: bathroomBounds.x + bathroomBounds.w - 10,
        y: bathroomBounds.y + bathroomBounds.h / 2,
      },
      approachCorridor: {
        x: bathroomBounds.x + bathroomBounds.w + 10,
        y: bathroomBounds.y + bathroomBounds.h / 2,
      },
      dwellSpots: bathroomDwellSpots,
      queueWaitSpots: bathroomQueueWaitSpots,
    },
    {
      name: 'pingpong',
      label: '탁구장',
      bounds: pingpongBounds,
      doorSide: 'left',
      interiorZone: {
        x: pingpongBounds.x + 16,
        y: pingpongBounds.y + 10,
        w: pingpongBounds.w - 24,
        h: pingpongBounds.h - 20,
      },
      approachInterior: {
        x: pingpongBounds.x + 10,
        y: pingpongBounds.y + pingpongBounds.h / 2,
      },
      approachCorridor: {
        x: pingpongBounds.x - 10,
        y: pingpongBounds.y + pingpongBounds.h / 2,
      },
    },
  ];

  function notifySelect() {
    for (const fn of selectListeners) fn(selected);
  }
  function notifyPermission(id: string, decision: 'allow' | 'deny' | 'always') {
    for (const fn of permissionListeners) fn(id, decision);
  }
  function notifyArrivedAtDesk(sessionId: string, agentName: string) {
    for (const fn of arrivedListeners) fn(sessionId, agentName);
  }

  function slotWorldBounds(idx: number): { bounds: Rect; row: 0 | 1; col: number } {
    const col = idx % OFFICE_COLS;
    const row = (idx < OFFICE_COLS ? 0 : 1) as 0 | 1;
    const x = OFFICE_MARGIN + FACILITY_W + col * ROOM_W;
    const y = row === 0 ? OFFICE_MARGIN : OFFICE_MARGIN + ROOM_H + CORRIDOR_H;
    return { bounds: { x, y, w: ROOM_W, h: ROOM_H }, row, col };
  }

  function buildStaticOffice() {
    const bg = new Graphics();
    drawOfficeBackground(bg, { x: OFFICE_MARGIN, y: OFFICE_MARGIN, w: OFFICE_W - OFFICE_MARGIN * 2, h: OFFICE_H - OFFICE_MARGIN * 2 });

    // Outdoor patches fill the 4 empty corners flanking the facilities
    const outdoorTL: Rect = {
      x: OFFICE_MARGIN,
      y: OFFICE_MARGIN,
      w: FACILITY_W,
      h: ROOM_H,
    };
    const outdoorBL: Rect = {
      x: OFFICE_MARGIN,
      y: OFFICE_MARGIN + ROOM_H + CORRIDOR_H,
      w: FACILITY_W,
      h: ROOM_H,
    };
    const outdoorTR: Rect = {
      x: OFFICE_MARGIN + FACILITY_W + OFFICE_COLS * ROOM_W,
      y: OFFICE_MARGIN,
      w: FACILITY_W,
      h: ROOM_H,
    };
    const outdoorBR: Rect = {
      x: OFFICE_MARGIN + FACILITY_W + OFFICE_COLS * ROOM_W,
      y: OFFICE_MARGIN + ROOM_H + CORRIDOR_H,
      w: FACILITY_W,
      h: ROOM_H,
    };
    drawOutdoorPatch(bg, outdoorTL);
    drawOutdoorPatch(bg, outdoorBL);
    drawOutdoorPatch(bg, outdoorTR);
    drawOutdoorPatch(bg, outdoorBR);

    drawCorridorFloor(bg, corridorBounds);
    for (let i = 0; i < OFFICE_SLOTS; i++) {
      const { bounds } = slotWorldBounds(i);
      drawRoomFloor(bg, bounds);
    }
    drawRoomFloor(bg, bathroomBounds);
    drawRoomFloor(bg, pingpongBounds);
    bgLayer.addChild(bg);

    for (let i = 0; i < OFFICE_SLOTS; i++) {
      slots.push(buildSlot(i));
    }

    buildFacility(facilities[0], drawBathroom);
    buildFacility(facilities[1], drawPingPong);
  }

  function buildFacility(f: FacilityInfo, drawInterior: (g: Graphics, bounds: Rect) => void) {
    const container = new Container();
    roomsLayer.addChild(container);

    // Interior decor
    const decor = new Graphics();
    drawInterior(decor, f.bounds);
    container.addChild(decor);

    // Walls with door gap toward corridor
    const walls = new Graphics();
    drawRoomWalls(walls, f.bounds, {
      side: f.doorSide,
      center: f.bounds.y + f.bounds.h / 2,
      width: DOOR_W,
    });
    container.addChild(walls);

    // Signboard on the corridor side of the door
    const sign = new Container();
    const signBg = new Graphics();
    const sw = 60;
    const sh = 12;
    signBg
      .rect(0, 0, sw, sh)
      .fill(PALETTE.signBgLit)
      .stroke({ color: 0x1a1a22, width: 1 });
    sign.addChild(signBg);
    const txt = new Text({
      text: f.label,
      style: new TextStyle({
        fontFamily: 'monospace',
        fontSize: 8,
        fill: PALETTE.signText,
        stroke: { color: 0x000000, width: 1 },
      }),
    });
    txt.anchor.set(0.5, 0);
    txt.x = sw / 2;
    txt.y = 2;
    sign.addChild(txt);
    sign.x = f.bounds.x + (f.bounds.w - sw) / 2;
    sign.y = f.bounds.y - sh - 2;
    container.addChild(sign);
  }

  function buildSlot(idx: number): RoomSlot {
    const { bounds, row, col } = slotWorldBounds(idx);
    const container = new Container();
    roomsLayer.addChild(container);

    // Walls + door
    const doorSide: 'top' | 'bottom' = row === 0 ? 'bottom' : 'top';
    const doorCenterX = bounds.x + bounds.w / 2;
    const wallsFx = new Graphics();
    drawRoomWalls(wallsFx, bounds, { side: doorSide, center: doorCenterX, width: DOOR_W });
    container.addChild(wallsFx);

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

    // Couch + plants along the non-desk long wall (also opposite door? no — near the door side)
    const deco = new Graphics();
    const couchX = bounds.x + 12;
    const couchY = doorSide === 'bottom' ? bounds.y + bounds.h - 42 : bounds.y + 18;
    drawCouch(deco, couchX, couchY);
    drawPlant(deco, bounds.x + bounds.w - 22, couchY - 6);
    drawPlant(deco, bounds.x + bounds.w - 46, couchY - 6);
    container.addChild(deco);

    const idlePositions: { x: number; y: number }[] = [];
    const idleBaseY = couchY + 6;
    for (let i = 0; i < 6; i++) {
      idlePositions.push({
        x: couchX + 6 + i * 12,
        y: idleBaseY + (i % 2 === 0 ? 0 : 4),
      });
    }

    // Main-agent wander zone (room interior, inset from walls and furniture)
    const mainInsetX = 10;
    const mainInsetTop = doorSide === 'bottom' ? 44 : 18;
    const mainInsetBottom = doorSide === 'bottom' ? 18 : 44;
    const mainWanderZone: Rect = {
      x: bounds.x + mainInsetX,
      y: bounds.y + mainInsetTop,
      w: bounds.w - mainInsetX * 2,
      h: bounds.h - mainInsetTop - mainInsetBottom,
    };
    // Sub-agent wander zone near the couch
    const subWanderZone: Rect = {
      x: couchX,
      y: couchY - 4,
      w: bounds.w - 24,
      h: 26,
    };

    // Door approach points
    const approachInterior = {
      x: doorCenterX,
      y: doorSide === 'bottom' ? bounds.y + bounds.h - 10 : bounds.y + 10,
    };
    const approachCorridor = {
      x: doorCenterX,
      y: doorSide === 'bottom' ? bounds.y + bounds.h + 8 : bounds.y - 8,
    };

    // Dim overlay (lights off) — visible while unclaimed
    const dimOverlay = new Graphics();
    drawRoomDimOverlay(dimOverlay, bounds);
    container.addChild(dimOverlay);

    // Signboard on the corridor side of the door
    const signContainer = new Container();
    const signBg = new Graphics();
    const signW = 76;
    const signH = 12;
    signBg.rect(0, 0, signW, signH).fill(PALETTE.signBg).stroke({ color: 0x1a1a22, width: 1 });
    signContainer.addChild(signBg);
    const signText = new Text({
      text: '(비어있음)',
      style: new TextStyle({
        fontFamily: 'monospace',
        fontSize: 7,
        fill: PALETTE.signTextDim,
        stroke: { color: 0x000000, width: 1 },
      }),
    });
    signText.anchor.set(0.5, 0);
    signText.x = signW / 2;
    signText.y = 2;
    signContainer.addChild(signText);
    signContainer.x = doorCenterX - signW / 2;
    signContainer.y =
      doorSide === 'bottom' ? bounds.y + bounds.h + 2 : bounds.y - signH - 2;
    container.addChild(signContainer);

    return {
      slotIndex: idx,
      row,
      col,
      bounds,
      container,
      deskPositions,
      idlePositions,
      mainWanderZone,
      subWanderZone,
      doorSide,
      doorWorldX: doorCenterX,
      approachInterior,
      approachCorridor,
      signContainer,
      signText,
      signBg,
      dimOverlay,
      session: null,
    };
  }

  function claimSlot(session: SessionInfo): RoomSlot | null {
    const slot = slots.find((s) => s.session === null);
    if (!slot) return null;
    slot.session = session;
    slot.dimOverlay.visible = false;
    slot.signText.text = session.projectName || '세션';
    slot.signText.style.fill = PALETTE.signText;
    slot.signBg.clear();
    const sw = 76;
    const sh = 12;
    slot.signBg
      .rect(0, 0, sw, sh)
      .fill(PALETTE.signBgLit)
      .stroke({ color: 0x1a1a22, width: 1 });
    return slot;
  }

  function releaseSlot(slot: RoomSlot) {
    slot.session = null;
    slot.dimOverlay.visible = true;
    slot.signText.text = '(비어있음)';
    slot.signText.style.fill = PALETTE.signTextDim;
    slot.signBg.clear();
    const sw = 76;
    const sh = 12;
    slot.signBg
      .rect(0, 0, sw, sh)
      .fill(PALETTE.signBg)
      .stroke({ color: 0x1a1a22, width: 1 });
  }

  buildStaticOffice();

  // Initial layout — fit the whole office into the current host size if possible.
  currentScale = fitScaleToHost();
  applyLayout();

  function deskFor(room: RoomSlot, agentName: string): { x: number; y: number } {
    const idx = stableIndex(agentName, room.deskPositions.length);
    return room.deskPositions[idx] ?? room.deskPositions[0] ?? { x: 80, y: 80 };
  }
  function stableIndex(s: string, mod: number): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h) % Math.max(1, mod);
  }

  function sync(
    sessions: SessionInfo[],
    agents: Map<string, AgentUiState>,
    pending: Map<string, PermissionRequest>
  ) {
    // Claim a slot for each new session; refresh signboard if projectName changed
    const seenSessions = new Set<string>();
    for (const s of sessions) {
      seenSessions.add(s.sessionId);
      const existing = rooms.get(s.sessionId);
      if (!existing) {
        const slot = claimSlot(s);
        if (slot) rooms.set(s.sessionId, slot);
      } else if (existing.session && existing.session.projectName !== s.projectName) {
        existing.session = s;
        existing.signText.text = s.projectName || '세션';
      }
    }
    // Release slots for closed sessions + cull their characters
    for (const [sid, slot] of [...rooms.entries()]) {
      if (!seenSessions.has(sid)) {
        releaseSlot(slot);
        rooms.delete(sid);
        for (const [key, ch] of characters) {
          if (key.startsWith(sid + ':')) {
            bathroom.evict(ch); // free slot/queue if occupied
            ch.container.destroy({ children: true });
            characters.delete(key);
          }
        }
      }
    }

    // Build permission lookup by character key
    const permByKey = new Map<string, PermissionRequest>();
    for (const req of pending.values()) {
      permByKey.set(`${req.sessionId}:${req.agentName}`, req);
    }

    // Ensure characters and drive state
    const seenChars = new Set<string>();
    for (const [key, ag] of agents) {
      const [sid, agentName] = key.split(':');
      const room = rooms.get(sid);
      if (!room) continue;
      seenChars.add(key);
      const wanderZone = agentName === 'main' ? room.mainWanderZone : room.subWanderZone;

      let ch = characters.get(key);
      const isNew = !ch;
      if (!ch) {
        const colorIdx = stableIndex(agentName, AGENT_COLORS.length);
        ch = new Character(
          agentName,
          colorIdx,
          () => {
            selected = { sessionId: sid, agentName };
            notifySelect();
          },
          (reqId, dec) => notifyPermission(reqId, dec)
        );
        charactersLayer.addChild(ch.container);
        // Spawn from corridor and walk through the door into the room
        ch.setPosition(room.approachCorridor.x, room.approachCorridor.y);
        ch.setWanderZone(wanderZone);
        ch.setCorridorExcursion({
          approachInterior: room.approachInterior,
          approachCorridor: room.approachCorridor,
          corridorZone: corridorWanderZone,
        });
        ch.setFacilities(facilities);
        ch.setBathroomManager(bathroom);
        const firstTarget = {
          x: wanderZone.x + Math.random() * wanderZone.w,
          y: wanderZone.y + Math.random() * wanderZone.h,
        };
        ch.walkPath([room.approachInterior, firstTarget]);
        characters.set(key, ch);
      } else {
        ch.setWanderZone(wanderZone);
        ch.setCorridorExcursion({
          approachInterior: room.approachInterior,
          approachCorridor: room.approachCorridor,
          corridorZone: corridorWanderZone,
        });
      }

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

      // Bubble priority: permission > tool intent > (chatter handled in tick)
      const perm = permByKey.get(key);
      if (perm) {
        ch.showPermission(perm);
      } else {
        // Clear stale permission bubble if the pending cleared
        if (ch.bubbleKind === 'permission') {
          ch.clearBubble();
        }
        if (ag.state === 'working' && ag.currentTool) {
          const summary = ag.currentInputSummary ?? '';
          if (ag.currentTool === 'Task' || ag.currentTool === 'Agent') {
            ch.sayHandoff(parseHandoffTarget(summary), summary);
          } else {
            ch.sayTool(ag.currentTool, summary);
          }
        }
      }

      ch.setSelected(
        !!selected && selected.sessionId === sid && selected.agentName === agentName
      );
    }

    // Remove stale characters
    for (const [key, ch] of characters) {
      if (!seenChars.has(key)) {
        ch.container.destroy({ children: true });
        characters.delete(key);
      }
    }
  }

  const meetings = new MeetingManager();
  const bathroom = new BathroomManager();
  const pingpong = new PingPongManager();
  const pingpongFacility = facilities[1];
  app.ticker.add((ticker) => {
    const dt = ticker.deltaMS / 1000;
    for (const ch of characters.values()) ch.tick(dt);
    meetings.update(dt, rooms, characters);
    pingpong.update(dt, rooms, characters, pingpongFacility, charactersLayer);
  });

  return {
    app,
    canvas: app.canvas,
    sync,
    onSelect(fn) {
      selectListeners.add(fn);
    },
    onPermissionChoice(fn) {
      permissionListeners.add(fn);
    },
    onAgentArrivedAtDesk(fn) {
      arrivedListeners.add(fn);
    },
    setSelected(sel) {
      selected = sel;
      for (const [key, ch] of characters) {
        const [sid, name] = key.split(':');
        ch.setSelected(!!sel && sel.sessionId === sid && sel.agentName === name);
      }
    },
    zoomIn() {
      currentScale = snapScale(currentScale + ZOOM_STEP);
      applyLayout();
    },
    zoomOut() {
      currentScale = snapScale(currentScale - ZOOM_STEP);
      applyLayout();
    },
    getZoom() {
      return currentScale;
    },
    destroy() {
      app.destroy(true, { children: true });
    },
  };
}
