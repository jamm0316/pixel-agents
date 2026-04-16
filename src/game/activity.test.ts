import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVITY_PRIORITY,
  ActivitySlot,
  BathroomManager,
  LaptopBank,
  shouldDrawLaptopOpen,
  type ActivityKind,
  type ActivityToken,
  type UrinalSlotIndex,
} from './activity.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeToken(id: string): ActivityToken {
  return { id };
}

// ---------------------------------------------------------------------------
// ACTIVITY_PRIORITY
// ---------------------------------------------------------------------------

describe('ACTIVITY_PRIORITY ordering', () => {
  test('work has the highest priority', () => {
    assert.equal(ACTIVITY_PRIORITY['work'], 4);
  });

  test('meeting and pingpong share priority 3', () => {
    assert.equal(ACTIVITY_PRIORITY['meeting'], 3);
    assert.equal(ACTIVITY_PRIORITY['pingpong'], 3);
  });

  test('toilet is lower than meeting', () => {
    assert.ok(ACTIVITY_PRIORITY['toilet'] < ACTIVITY_PRIORITY['meeting']);
  });

  test('chatter is lower than toilet', () => {
    assert.ok(ACTIVITY_PRIORITY['chatter'] < ACTIVITY_PRIORITY['toilet']);
  });

  test('wander has the lowest priority', () => {
    assert.equal(ACTIVITY_PRIORITY['wander'], 0);
    const allKinds: ActivityKind[] = ['work', 'meeting', 'pingpong', 'toilet', 'chatter', 'wander'];
    for (const k of allKinds) {
      assert.ok(ACTIVITY_PRIORITY['wander'] <= ACTIVITY_PRIORITY[k]);
    }
  });

  test('full ordering: work > meeting = pingpong > toilet > chatter > wander', () => {
    assert.ok(ACTIVITY_PRIORITY['work'] > ACTIVITY_PRIORITY['meeting']);
    assert.equal(ACTIVITY_PRIORITY['meeting'], ACTIVITY_PRIORITY['pingpong']);
    assert.ok(ACTIVITY_PRIORITY['meeting'] > ACTIVITY_PRIORITY['toilet']);
    assert.ok(ACTIVITY_PRIORITY['toilet'] > ACTIVITY_PRIORITY['chatter']);
    assert.ok(ACTIVITY_PRIORITY['chatter'] > ACTIVITY_PRIORITY['wander']);
  });
});

// ---------------------------------------------------------------------------
// ActivitySlot.tryStartActivity
// ---------------------------------------------------------------------------

describe('ActivitySlot.tryStartActivity — empty slot', () => {
  test('accepts any activity when slot is empty', () => {
    const slot = new ActivitySlot();
    assert.equal(slot.tryStartActivity('wander'), true);
    assert.equal(slot.currentActivity, 'wander');
  });

  test('returns true and sets currentActivity', () => {
    const slot = new ActivitySlot();
    const accepted = slot.tryStartActivity('work');
    assert.equal(accepted, true);
    assert.equal(slot.currentActivity, 'work');
  });
});

describe('ActivitySlot.tryStartActivity — preemption (higher priority wins)', () => {
  test('work preempts wander', () => {
    const slot = new ActivitySlot();
    slot.tryStartActivity('wander');
    const accepted = slot.tryStartActivity('work');
    assert.equal(accepted, true);
    assert.equal(slot.currentActivity, 'work');
  });

  test('work preempts toilet', () => {
    const slot = new ActivitySlot();
    slot.tryStartActivity('toilet');
    const accepted = slot.tryStartActivity('work');
    assert.equal(accepted, true);
    assert.equal(slot.currentActivity, 'work');
  });

  test('meeting preempts chatter', () => {
    const slot = new ActivitySlot();
    slot.tryStartActivity('chatter');
    assert.equal(slot.tryStartActivity('meeting'), true);
    assert.equal(slot.currentActivity, 'meeting');
  });

  test('preempt calls onActivityPreempt with new kind', () => {
    const slot = new ActivitySlot();
    slot.tryStartActivity('wander');
    let capturedBy: ActivityKind | undefined;
    slot.onActivityPreempt = (by) => { capturedBy = by; };
    slot.tryStartActivity('work');
    assert.equal(capturedBy, 'work');
  });

  test('onActivityPreempt is cleared after preemption', () => {
    const slot = new ActivitySlot();
    slot.tryStartActivity('wander');
    slot.onActivityPreempt = () => {};
    slot.tryStartActivity('work');
    assert.equal(slot.onActivityPreempt, undefined);
  });
});

describe('ActivitySlot.tryStartActivity — rejection (equal or lower priority)', () => {
  test('equal priority pingpong cannot preempt meeting', () => {
    const slot = new ActivitySlot();
    slot.tryStartActivity('meeting');
    const accepted = slot.tryStartActivity('pingpong');
    assert.equal(accepted, false);
    assert.equal(slot.currentActivity, 'meeting');
  });

  test('equal priority meeting cannot preempt pingpong', () => {
    const slot = new ActivitySlot();
    slot.tryStartActivity('pingpong');
    assert.equal(slot.tryStartActivity('meeting'), false);
    assert.equal(slot.currentActivity, 'pingpong');
  });

  test('lower priority wander cannot preempt toilet', () => {
    const slot = new ActivitySlot();
    slot.tryStartActivity('toilet');
    assert.equal(slot.tryStartActivity('wander'), false);
    assert.equal(slot.currentActivity, 'toilet');
  });

  test('lower priority chatter cannot preempt work', () => {
    const slot = new ActivitySlot();
    slot.tryStartActivity('work');
    assert.equal(slot.tryStartActivity('chatter'), false);
    assert.equal(slot.currentActivity, 'work');
  });

  test('returns false on rejection and does NOT call onActivityPreempt', () => {
    const slot = new ActivitySlot();
    slot.tryStartActivity('work');
    let called = false;
    slot.onActivityPreempt = () => { called = true; };
    slot.tryStartActivity('wander');
    assert.equal(called, false);
    // hook must still be intact after rejection
    assert.ok(slot.onActivityPreempt !== undefined);
  });
});

// ---------------------------------------------------------------------------
// ActivitySlot.endActivity
// ---------------------------------------------------------------------------

describe('ActivitySlot.endActivity', () => {
  test('clears slot when kind matches', () => {
    const slot = new ActivitySlot();
    slot.tryStartActivity('toilet');
    slot.endActivity('toilet');
    assert.equal(slot.currentActivity, null);
  });

  test('clears onActivityPreempt when kind matches', () => {
    const slot = new ActivitySlot();
    slot.tryStartActivity('work');
    slot.onActivityPreempt = () => {};
    slot.endActivity('work');
    assert.equal(slot.onActivityPreempt, undefined);
  });

  test('no-op when kind does not match current activity', () => {
    const slot = new ActivitySlot();
    slot.tryStartActivity('meeting');
    slot.endActivity('wander'); // wrong kind — no-op
    assert.equal(slot.currentActivity, 'meeting');
  });

  test('no-op when slot is already empty', () => {
    const slot = new ActivitySlot();
    // should not throw
    slot.endActivity('work');
    assert.equal(slot.currentActivity, null);
  });

  test('no-op protects against late callbacks after preemption', () => {
    // Scenario: wander is preempted by work. The wander path callback
    // eventually calls endActivity('wander') — should be harmless.
    const slot = new ActivitySlot();
    slot.tryStartActivity('wander');
    slot.tryStartActivity('work'); // preempts wander
    assert.equal(slot.currentActivity, 'work');
    slot.endActivity('wander'); // stale callback — must be no-op
    assert.equal(slot.currentActivity, 'work');
  });
});

// ---------------------------------------------------------------------------
// BathroomManager.request
// ---------------------------------------------------------------------------

describe('BathroomManager.request — immediate assignment', () => {
  test('first requester gets assigned slot 0', () => {
    const mgr = new BathroomManager();
    const a = makeToken('a');
    const result = mgr.request(a, () => {});
    assert.equal(result.kind, 'assigned');
    if (result.kind === 'assigned') {
      assert.ok(result.slot === 0 || result.slot === 1);
    }
  });

  test('second requester gets the other slot when first is taken', () => {
    const mgr = new BathroomManager();
    const a = makeToken('a');
    const b = makeToken('b');
    const r1 = mgr.request(a, () => {});
    const r2 = mgr.request(b, () => {});
    assert.equal(r1.kind, 'assigned');
    assert.equal(r2.kind, 'assigned');
    if (r1.kind === 'assigned' && r2.kind === 'assigned') {
      assert.notEqual(r1.slot, r2.slot);
    }
  });
});

describe('BathroomManager.request — queue when full', () => {
  test('third requester is queued at position 0', () => {
    const mgr = new BathroomManager();
    mgr.request(makeToken('a'), () => {});
    mgr.request(makeToken('b'), () => {});
    const c = makeToken('c');
    const result = mgr.request(c, () => {});
    assert.equal(result.kind, 'queued');
    if (result.kind === 'queued') {
      assert.equal(result.position, 0);
    }
  });

  test('fourth requester is queued at position 1', () => {
    const mgr = new BathroomManager();
    mgr.request(makeToken('a'), () => {});
    mgr.request(makeToken('b'), () => {});
    mgr.request(makeToken('c'), () => {});
    const d = makeToken('d');
    const result = mgr.request(d, () => {});
    assert.equal(result.kind, 'queued');
    if (result.kind === 'queued') {
      assert.equal(result.position, 1);
    }
  });
});

// ---------------------------------------------------------------------------
// BathroomManager.releaseUrinal
// ---------------------------------------------------------------------------

describe('BathroomManager.releaseUrinal', () => {
  test('frees the slot so next request can assign immediately', () => {
    const mgr = new BathroomManager();
    const a = makeToken('a');
    mgr.request(a, () => {});
    mgr.releaseUrinal(a);
    const b = makeToken('b');
    const result = mgr.request(b, () => {});
    assert.equal(result.kind, 'assigned');
  });

  test('promotes first waiter from queue when slot is released', () => {
    const mgr = new BathroomManager();
    const a = makeToken('a');
    const b = makeToken('b');
    const c = makeToken('c');
    mgr.request(a, () => {});
    mgr.request(b, () => {});
    mgr.request(c, () => {}); // queued at position 0

    let assignedSlot: UrinalSlotIndex | undefined;
    // Re-request c with a real callback
    const mgr2 = new BathroomManager();
    const a2 = makeToken('a2');
    const b2 = makeToken('b2');
    const c2 = makeToken('c2');
    mgr2.request(a2, () => {});
    mgr2.request(b2, () => {});
    mgr2.request(c2, (slot) => { assignedSlot = slot; });

    mgr2.releaseUrinal(a2);
    assert.ok(assignedSlot === 0 || assignedSlot === 1, 'onAssigned should have been called');
    assert.equal(mgr2.queueSnapshot().length, 0, 'queue should be empty after promotion');
  });

  test('is no-op if character was not occupying a slot', () => {
    const mgr = new BathroomManager();
    const a = makeToken('a');
    const stranger = makeToken('stranger');
    mgr.request(a, () => {});
    // releasing someone who never entered should not throw or corrupt state
    mgr.releaseUrinal(stranger);
    assert.equal(mgr.slotOccupant(0), a);
  });

  test('FIFO order: 3 waiters, first releaser promotes oldest waiter', () => {
    const mgr = new BathroomManager();
    const [a, b, c, d, e] = ['a', 'b', 'c', 'd', 'e'].map(makeToken);

    mgr.request(a, () => {});
    mgr.request(b, () => {});

    const promoted: string[] = [];
    mgr.request(c, () => { promoted.push('c'); });
    mgr.request(d, () => { promoted.push('d'); });
    mgr.request(e, () => { promoted.push('e'); });

    // Release a → c (oldest waiter) should be promoted
    mgr.releaseUrinal(a);
    assert.deepEqual(promoted, ['c']);

    // Release b → d
    mgr.releaseUrinal(b);
    assert.deepEqual(promoted, ['c', 'd']);
  });
});

// ---------------------------------------------------------------------------
// BathroomManager.evict
// ---------------------------------------------------------------------------

describe('BathroomManager.evict — slot occupant', () => {
  test('evicting slot occupant frees the slot', () => {
    const mgr = new BathroomManager();
    const a = makeToken('a');
    const r = mgr.request(a, () => {});
    assert.equal(r.kind, 'assigned');
    mgr.evict(a);
    if (r.kind === 'assigned') {
      assert.equal(mgr.slotOccupant(r.slot), null);
    }
  });

  test('evicting slot occupant promotes queue head', () => {
    const mgr = new BathroomManager();
    const a = makeToken('a');
    const b = makeToken('b');
    const c = makeToken('c');
    mgr.request(a, () => {});
    mgr.request(b, () => {});
    let called = false;
    mgr.request(c, () => { called = true; });

    mgr.evict(a);
    assert.equal(called, true, 'queue head onAssigned should fire on evict');
    assert.equal(mgr.queueSnapshot().length, 0);
  });
});

describe('BathroomManager.evict — queue waiter', () => {
  test('evicting queued waiter removes them without affecting slots', () => {
    const mgr = new BathroomManager();
    const a = makeToken('a');
    const b = makeToken('b');
    const c = makeToken('c');
    mgr.request(a, () => {});
    mgr.request(b, () => {});
    mgr.request(c, () => {});

    // c is queued. Evict c.
    mgr.evict(c);
    assert.equal(mgr.queueSnapshot().length, 0, 'queue should be empty');
    // slots remain occupied by a and b
    assert.equal(mgr.slotOccupant(0), a);
    assert.equal(mgr.slotOccupant(1), b);
  });

  test('evicting mid-queue waiter leaves other waiters intact', () => {
    const mgr = new BathroomManager();
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(makeToken);
    mgr.request(a, () => {});
    mgr.request(b, () => {});
    mgr.request(c, () => {});
    mgr.request(d, () => {});

    // queue: [c, d]. Evict c.
    mgr.evict(c);
    const q = mgr.queueSnapshot();
    assert.equal(q.length, 1);
    assert.equal(q[0].id, 'd');
  });

  test('evict is safe if character is in neither slot nor queue', () => {
    const mgr = new BathroomManager();
    const stranger = makeToken('stranger');
    // should not throw
    mgr.evict(stranger);
    assert.equal(mgr.queueSnapshot().length, 0);
  });
});

// ---------------------------------------------------------------------------
// LaptopBank
// ---------------------------------------------------------------------------

// T1: acquire — empty bank
describe('LaptopBank.acquire — empty bank', () => {
  test('first token gets index 0', () => {
    const bank = new LaptopBank(6);
    const a = makeToken('a');
    const idx = bank.acquire(a);
    assert.equal(idx, 0);
  });

  test('second token gets index 1 (lowest free index)', () => {
    const bank = new LaptopBank(6);
    bank.acquire(makeToken('a'));
    const idx = bank.acquire(makeToken('b'));
    assert.equal(idx, 1);
  });

  test('tokens 1 through 6 get indices 0 through 5 in order', () => {
    const bank = new LaptopBank(6);
    for (let i = 0; i < 6; i++) {
      const idx = bank.acquire(makeToken(`t${i}`));
      assert.equal(idx, i);
    }
  });
});

// T2: acquire — full bank
describe('LaptopBank.acquire — full bank', () => {
  test('7th token gets null when all 6 slots are occupied', () => {
    const bank = new LaptopBank(6);
    for (let i = 0; i < 6; i++) bank.acquire(makeToken(`t${i}`));
    const idx = bank.acquire(makeToken('overflow'));
    assert.equal(idx, null);
  });
});

// T3: acquire — 1:1 occupancy guarantee
describe('LaptopBank.acquire — 1:1 occupancy guarantee', () => {
  test('token A gets index 0, token B gets index 1 (not 0)', () => {
    const bank = new LaptopBank(6);
    const a = makeToken('a');
    const b = makeToken('b');
    const idxA = bank.acquire(a);
    const idxB = bank.acquire(b);
    assert.equal(idxA, 0);
    assert.equal(idxB, 1);
    assert.notEqual(idxB, idxA);
  });

  test('slot occupied by A cannot be acquired by B', () => {
    const bank = new LaptopBank(6);
    const a = makeToken('a');
    const b = makeToken('b');
    bank.acquire(a);
    bank.acquire(b);
    // Both slots are distinct — slotOccupant(0) must be a, not b
    assert.equal(bank.slotOccupant(0), a);
    assert.equal(bank.slotOccupant(1), b);
  });
});

// T4: acquire — duplicate acquire for same token
describe('LaptopBank.acquire — duplicate acquire for same token', () => {
  test('same token acquire twice returns same index', () => {
    const bank = new LaptopBank(6);
    const a = makeToken('a');
    const first = bank.acquire(a);
    const second = bank.acquire(a);
    assert.equal(first, second);
  });

  test('duplicate acquire does not increase slot usage', () => {
    const bank = new LaptopBank(6);
    const a = makeToken('a');
    bank.acquire(a);
    bank.acquire(a); // duplicate
    // Only 1 slot used, the next token should still get index 1
    const b = makeToken('b');
    const idxB = bank.acquire(b);
    assert.equal(idxB, 1);
    assert.equal(bank.occupiedIndices().length, 2);
  });
});

// T5: release
describe('LaptopBank.release', () => {
  test('released slot becomes null', () => {
    const bank = new LaptopBank(6);
    const a = makeToken('a');
    const idx = bank.acquire(a) as number;
    bank.release(a);
    assert.equal(bank.slotOccupant(idx), null);
  });

  test('after release another token can acquire the freed slot (lowest free index)', () => {
    const bank = new LaptopBank(6);
    const a = makeToken('a');
    const b = makeToken('b');
    bank.acquire(a); // index 0
    bank.acquire(b); // index 1
    bank.release(a); // free index 0
    const c = makeToken('c');
    const idxC = bank.acquire(c);
    assert.equal(idxC, 0); // lowest free is 0
  });

  test('releasing a token that never acquired is a no-op (no throw)', () => {
    const bank = new LaptopBank(6);
    const stranger = makeToken('stranger');
    // must not throw
    bank.release(stranger);
    assert.equal(bank.occupiedIndices().length, 0);
  });
});

// T6: release — other slots unaffected
describe('LaptopBank.release — other slots unaffected', () => {
  test('A->0, B->1, C->2 acquire then B release — A and C slots unchanged', () => {
    const bank = new LaptopBank(6);
    const a = makeToken('a');
    const b = makeToken('b');
    const c = makeToken('c');
    bank.acquire(a); // 0
    bank.acquire(b); // 1
    bank.acquire(c); // 2
    bank.release(b);
    assert.equal(bank.slotOccupant(0), a);
    assert.equal(bank.slotOccupant(1), null);
    assert.equal(bank.slotOccupant(2), c);
  });
});

// T7: occupiedIndices
describe('LaptopBank.occupiedIndices', () => {
  test('returns empty array when bank is empty', () => {
    const bank = new LaptopBank(6);
    assert.deepEqual(bank.occupiedIndices(), []);
  });

  test('returns correct indices after selective acquires', () => {
    const bank = new LaptopBank(6);
    // Acquire slots 0,1,2,3,4,5 then release 1,3,5 → occupied: 0,2,4
    const tokens = Array.from({ length: 6 }, (_, i) => makeToken(`t${i}`));
    tokens.forEach((t) => bank.acquire(t));
    bank.release(tokens[1]);
    bank.release(tokens[3]);
    bank.release(tokens[5]);
    const occupied = bank.occupiedIndices().sort((x, y) => x - y);
    assert.deepEqual(occupied, [0, 2, 4]);
  });
});

// T8: full acquire -> release one -> next acquire gets freed index
describe('LaptopBank — full acquire then partial release', () => {
  test('0..5 occupied, slot 2 released, new token gets index 2', () => {
    const bank = new LaptopBank(6);
    const tokens = Array.from({ length: 6 }, (_, i) => makeToken(`t${i}`));
    tokens.forEach((t) => bank.acquire(t));
    bank.release(tokens[2]); // free index 2
    const newcomer = makeToken('new');
    const idx = bank.acquire(newcomer);
    assert.equal(idx, 2);
  });
});

// T9: two managers are independent
describe('LaptopBank — two managers are independent', () => {
  test('acquire on mgr1 does not affect mgr2', () => {
    const mgr1 = new LaptopBank(6);
    const mgr2 = new LaptopBank(6);
    const a = makeToken('a');
    mgr1.acquire(a);
    // mgr2 should still have all slots free
    assert.equal(mgr2.occupiedIndices().length, 0);
    const b = makeToken('b');
    const idx = mgr2.acquire(b);
    assert.equal(idx, 0);
  });
});

// ---------------------------------------------------------------------------
// shouldDrawLaptopOpen
// ---------------------------------------------------------------------------

// T10: null occupant → closed
describe('shouldDrawLaptopOpen — null occupant', () => {
  test('returns false for null', () => {
    assert.equal(shouldDrawLaptopOpen(null), false);
  });
});

// T11: walking_to_desk occupant → closed
describe('shouldDrawLaptopOpen — walking_to_desk occupant', () => {
  test('returns false when occupant state is walking_to_desk', () => {
    assert.equal(shouldDrawLaptopOpen({ state: 'walking_to_desk' }), false);
  });
});

// T12: working occupant → open
describe('shouldDrawLaptopOpen — working occupant', () => {
  test('returns true when occupant state is working', () => {
    assert.equal(shouldDrawLaptopOpen({ state: 'working' }), true);
  });
});

// T13: other states → closed
describe('shouldDrawLaptopOpen — other states', () => {
  test('returns false for idle', () => {
    assert.equal(shouldDrawLaptopOpen({ state: 'idle' }), false);
  });

  test('returns false for walking_home', () => {
    assert.equal(shouldDrawLaptopOpen({ state: 'walking_home' }), false);
  });

  test('returns false for unknown future state', () => {
    assert.equal(shouldDrawLaptopOpen({ state: 'some_future_state' }), false);
  });
});
