import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, initialState } from './store.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgentStart(overrides: Partial<{ sessionId: string; agentName: string; timestamp: number }> = {}) {
  return {
    kind: 'agent-start' as const,
    sessionId: overrides.sessionId ?? 's1',
    agentName: overrides.agentName ?? 'main',
    tool: 'Task',
    inputSummary: 'do something',
    toolCallId: 'tc1',
    timestamp: overrides.timestamp ?? 1,
  };
}

function makeAgentTool(overrides: Partial<{ sessionId: string; agentName: string; tool: string; inputSummary: string; toolCallId: string; timestamp: number }> = {}) {
  return {
    kind: 'agent-tool' as const,
    sessionId: overrides.sessionId ?? 's1',
    agentName: overrides.agentName ?? 'main',
    tool: overrides.tool ?? 'Read',
    inputSummary: overrides.inputSummary ?? 'reading file',
    toolCallId: overrides.toolCallId ?? 'tc2',
    timestamp: overrides.timestamp ?? 2,
  };
}

function makeArrivedAtDesk(overrides: Partial<{ sessionId: string; agentName: string; timestamp: number }> = {}) {
  return {
    kind: 'agent-arrived-at-desk' as const,
    sessionId: overrides.sessionId ?? 's1',
    agentName: overrides.agentName ?? 'main',
    timestamp: overrides.timestamp ?? 3,
  };
}

function makeAgentStop(overrides: Partial<{ sessionId: string; agentName: string; timestamp: number }> = {}) {
  return {
    kind: 'agent-stop' as const,
    sessionId: overrides.sessionId ?? 's1',
    agentName: overrides.agentName ?? 'main',
    timestamp: overrides.timestamp ?? 4,
  };
}

function agentOf(state: ReturnType<typeof initialState>, sessionId = 's1', agentName = 'main') {
  return state.agents.get(`${sessionId}:${agentName}`);
}

// ---------------------------------------------------------------------------
// 1. agent-start transitions idle -> walking_to_desk
// ---------------------------------------------------------------------------

describe('store / walking_to_desk transition on agent-start', () => {
  test('idle agent transitions to walking_to_desk on agent-start', () => {
    const s = applyEvent(initialState(), makeAgentStart());
    const a = agentOf(s);
    assert.equal(a?.state, 'walking_to_desk');
  });
});

// ---------------------------------------------------------------------------
// 2. agent-tool transitions idle -> walking_to_desk and records tool info
// ---------------------------------------------------------------------------

describe('store / walking_to_desk transition on agent-tool', () => {
  test('idle agent transitions to walking_to_desk on agent-tool', () => {
    const s = applyEvent(initialState(), makeAgentTool());
    const a = agentOf(s);
    assert.equal(a?.state, 'walking_to_desk');
  });

  test('agent-tool sets currentTool', () => {
    const s = applyEvent(initialState(), makeAgentTool({ tool: 'Write' }));
    const a = agentOf(s);
    assert.equal(a?.currentTool, 'Write');
  });

  test('agent-tool sets currentInputSummary', () => {
    const s = applyEvent(initialState(), makeAgentTool({ inputSummary: 'writing output.txt' }));
    const a = agentOf(s);
    assert.equal(a?.currentInputSummary, 'writing output.txt');
  });

  test('agent-tool adds a running ToolCall to history', () => {
    const s = applyEvent(initialState(), makeAgentTool({ toolCallId: 'tcX' }));
    const a = agentOf(s);
    assert.equal(a?.history.length, 1);
    assert.equal(a?.history[0].id, 'tcX');
    assert.equal(a?.history[0].status, 'running');
  });
});

// ---------------------------------------------------------------------------
// 3. agent-tool while already working stays working
// ---------------------------------------------------------------------------

describe('store / agent-tool while already working stays working', () => {
  test('working agent stays working on agent-tool', () => {
    // First, get to working state via agent-start + agent-arrived-at-desk
    let s = applyEvent(initialState(), makeAgentStart({ timestamp: 1 }));
    s = applyEvent(s, makeArrivedAtDesk({ timestamp: 2 }));
    assert.equal(agentOf(s)?.state, 'working');

    s = applyEvent(s, makeAgentTool({ timestamp: 3 }));
    assert.equal(agentOf(s)?.state, 'working');
  });
});

// ---------------------------------------------------------------------------
// 4. agent-tool while walking_to_desk stays walking_to_desk
// ---------------------------------------------------------------------------

describe('store / agent-tool while walking_to_desk stays walking_to_desk', () => {
  test('walking_to_desk agent stays walking_to_desk on additional agent-tool', () => {
    let s = applyEvent(initialState(), makeAgentStart({ timestamp: 1 }));
    assert.equal(agentOf(s)?.state, 'walking_to_desk');

    s = applyEvent(s, makeAgentTool({ tool: 'Bash', timestamp: 2 }));
    assert.equal(agentOf(s)?.state, 'walking_to_desk');
  });

  test('currentTool is updated even while walking_to_desk', () => {
    let s = applyEvent(initialState(), makeAgentStart({ timestamp: 1 }));
    s = applyEvent(s, makeAgentTool({ tool: 'Bash', timestamp: 2 }));
    assert.equal(agentOf(s)?.currentTool, 'Bash');
  });
});

// ---------------------------------------------------------------------------
// 5. agent-arrived-at-desk promotes walking_to_desk to working
// ---------------------------------------------------------------------------

describe('store / agent-arrived-at-desk promotes walking_to_desk to working', () => {
  test('walking_to_desk transitions to working on agent-arrived-at-desk', () => {
    let s = applyEvent(initialState(), makeAgentStart({ timestamp: 1 }));
    assert.equal(agentOf(s)?.state, 'walking_to_desk');

    s = applyEvent(s, makeArrivedAtDesk({ timestamp: 2 }));
    assert.equal(agentOf(s)?.state, 'working');
  });
});

// ---------------------------------------------------------------------------
// 6. agent-arrived-at-desk is ignored when not walking_to_desk
// ---------------------------------------------------------------------------

describe('store / agent-arrived-at-desk is ignored when not walking_to_desk', () => {
  test('idle agent stays idle on agent-arrived-at-desk', () => {
    const s = applyEvent(initialState(), makeArrivedAtDesk({ timestamp: 1 }));
    const a = agentOf(s);
    assert.equal(a?.state, 'idle');
  });

  test('working agent stays working on agent-arrived-at-desk', () => {
    let s = applyEvent(initialState(), makeAgentStart({ timestamp: 1 }));
    s = applyEvent(s, makeArrivedAtDesk({ timestamp: 2 }));
    assert.equal(agentOf(s)?.state, 'working');

    // Fire arrived-at-desk again while already working
    s = applyEvent(s, makeArrivedAtDesk({ timestamp: 3 }));
    assert.equal(agentOf(s)?.state, 'working');
  });
});

// ---------------------------------------------------------------------------
// 7. agent-stop resets walking_to_desk to idle
// ---------------------------------------------------------------------------

describe('store / agent-stop resets walking_to_desk to idle', () => {
  test('walking_to_desk transitions to idle on agent-stop', () => {
    let s = applyEvent(initialState(), makeAgentStart({ timestamp: 1 }));
    assert.equal(agentOf(s)?.state, 'walking_to_desk');

    s = applyEvent(s, makeAgentStop({ timestamp: 2 }));
    assert.equal(agentOf(s)?.state, 'idle');
  });

  test('currentTool is cleared on agent-stop', () => {
    let s = applyEvent(initialState(), makeAgentTool({ timestamp: 1 }));
    assert.equal(agentOf(s)?.currentTool, 'Read');

    s = applyEvent(s, makeAgentStop({ timestamp: 2 }));
    assert.equal(agentOf(s)?.currentTool, undefined);
  });
});

// ---------------------------------------------------------------------------
// 8. race: agent-arrived-at-desk after agent-stop stays idle
// ---------------------------------------------------------------------------

describe('store / race: agent-arrived-at-desk after agent-stop stays idle', () => {
  test('arrived-at-desk does not resurrect working state after agent-stop', () => {
    let s = applyEvent(initialState(), makeAgentStart({ timestamp: 1 }));
    assert.equal(agentOf(s)?.state, 'walking_to_desk');

    s = applyEvent(s, makeAgentStop({ timestamp: 2 }));
    assert.equal(agentOf(s)?.state, 'idle');

    // Stale arrived-at-desk callback fires after agent-stop
    s = applyEvent(s, makeArrivedAtDesk({ timestamp: 3 }));
    assert.equal(agentOf(s)?.state, 'idle');
  });
});
