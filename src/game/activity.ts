/**
 * activity.ts — Pure activity-priority logic extracted from PixiApp.ts.
 *
 * This module has NO pixi.js dependency and is designed to be imported by
 * unit tests (node:test + tsx). PixiApp.ts imports from here so that the
 * single source of truth stays in this file.
 */

export type ActivityKind =
  | 'work'
  | 'meeting'
  | 'pingpong'
  | 'toilet'
  | 'chatter'
  | 'wander';

export const ACTIVITY_PRIORITY: Record<ActivityKind, number> = {
  work: 4,
  meeting: 3,
  pingpong: 3,
  toilet: 2,
  chatter: 1,
  wander: 0,
};

export type UrinalSlotIndex = 0 | 1;

type BathroomSlotState = { index: UrinalSlotIndex; occupant: ActivityToken | null };
type BathroomWaiter = { token: ActivityToken; onAssigned: (slot: UrinalSlotIndex) => void };

/**
 * Minimal opaque identity token used by BathroomManager.
 * In production PixiApp.ts the Character object plays this role.
 * Tests create lightweight plain objects that satisfy this interface.
 */
export interface ActivityToken {
  readonly id: string;
}

/**
 * Tracks physical urinal occupancy (2 slots) and a FIFO wait queue.
 * Pure data-structure logic — no pixi.js or DOM dependencies.
 */
export class BathroomManager {
  private slots: BathroomSlotState[] = [
    { index: 0, occupant: null },
    { index: 1, occupant: null },
  ];
  private queue: BathroomWaiter[] = [];

  request(
    token: ActivityToken,
    onAssigned: (slot: UrinalSlotIndex) => void
  ): { kind: 'assigned'; slot: UrinalSlotIndex } | { kind: 'queued'; position: number } {
    const free = this.slots.find((s) => s.occupant === null);
    if (free) {
      free.occupant = token;
      return { kind: 'assigned', slot: free.index };
    }
    this.queue.push({ token, onAssigned });
    return { kind: 'queued', position: this.queue.length - 1 };
  }

  releaseUrinal(token: ActivityToken): void {
    const slot = this.slots.find((s) => s.occupant === token);
    if (!slot) return;
    slot.occupant = null;
    const next = this.queue.shift();
    if (next) {
      slot.occupant = next.token;
      next.onAssigned(slot.index);
    }
  }

  removeFromQueue(token: ActivityToken): void {
    const idx = this.queue.findIndex((w) => w.token === token);
    if (idx !== -1) this.queue.splice(idx, 1);
  }

  evict(token: ActivityToken): void {
    this.releaseUrinal(token);
    this.removeFromQueue(token);
  }

  /** For test introspection only */
  slotOccupant(index: UrinalSlotIndex): ActivityToken | null {
    return this.slots[index].occupant;
  }

  /** For test introspection only */
  queueSnapshot(): ActivityToken[] {
    return this.queue.map((w) => w.token);
  }
}

export type LaptopSlotIndex = number;

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

  slotCount(): number {
    return this.slots.length;
  }
}

export interface LaptopVisualOccupant {
  state: 'idle' | 'walking_to_desk' | 'working' | 'walking_home' | string;
}

export function shouldDrawLaptopOpen(
  occupant: LaptopVisualOccupant | null
): boolean {
  return occupant !== null && occupant.state === 'working';
}

/**
 * Minimal Character-like activity slot for unit testing tryStartActivity /
 * endActivity without pixi.js.
 */
export class ActivitySlot {
  currentActivity: ActivityKind | null = null;
  onActivityPreempt: ((preemptedBy: ActivityKind) => void) | undefined;

  tryStartActivity(kind: ActivityKind): boolean {
    if (this.currentActivity !== null) {
      const cur = ACTIVITY_PRIORITY[this.currentActivity];
      const next = ACTIVITY_PRIORITY[kind];
      if (next <= cur) return false;
      const preemptCb = this.onActivityPreempt;
      this.onActivityPreempt = undefined;
      this.currentActivity = null;
      preemptCb?.(kind);
    }
    this.currentActivity = kind;
    return true;
  }

  endActivity(kind: ActivityKind): void {
    if (this.currentActivity !== kind) return;
    this.currentActivity = null;
    this.onActivityPreempt = undefined;
  }
}
