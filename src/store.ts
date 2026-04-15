import type { SessionInfo, AgentUiState, StreamEvent, ToolCall, PermissionRequest } from './types';

export type AppState = {
  sessions: Map<string, SessionInfo>;
  agents: Map<string, AgentUiState>; // key = sessionId:agentName
  selected: { sessionId: string; agentName: string } | null;
  pending: Map<string, PermissionRequest>;
};

export function initialState(): AppState {
  return { sessions: new Map(), agents: new Map(), selected: null, pending: new Map() };
}

export function key(sessionId: string, agentName: string): string {
  return `${sessionId}:${agentName}`;
}

function ensureAgent(state: AppState, sessionId: string, agentName: string): AgentUiState {
  const k = key(sessionId, agentName);
  let a = state.agents.get(k);
  if (!a) {
    a = {
      name: agentName,
      state: 'idle',
      currentTool: undefined,
      currentInputSummary: undefined,
      lastEventAt: Date.now(),
      history: [],
    };
    state.agents.set(k, a);
  }
  return a;
}

function initAgentsForSession(state: AppState, s: SessionInfo) {
  ensureAgent(state, s.sessionId, 'main');
  for (const def of s.squad) {
    if (def.name === 'main') continue;
    const a = ensureAgent(state, s.sessionId, def.name);
    a.description = def.description;
  }
}

export function applyEvent(prev: AppState, evt: StreamEvent): AppState {
  const state: AppState = {
    sessions: new Map(prev.sessions),
    agents: new Map(prev.agents),
    selected: prev.selected,
    pending: new Map(prev.pending),
  };
  switch (evt.kind) {
    case 'snapshot': {
      state.sessions.clear();
      for (const s of evt.sessions) {
        state.sessions.set(s.sessionId, s);
        initAgentsForSession(state, s);
      }
      state.pending.clear();
      for (const p of evt.pending) state.pending.set(p.requestId, p);
      break;
    }
    case 'permission-request': {
      state.pending.set(evt.req.requestId, evt.req);
      break;
    }
    case 'permission-resolved': {
      state.pending.delete(evt.requestId);
      break;
    }
    case 'session-open': {
      state.sessions.set(evt.session.sessionId, evt.session);
      initAgentsForSession(state, evt.session);
      break;
    }
    case 'session-close': {
      state.sessions.delete(evt.sessionId);
      for (const k of [...state.agents.keys()]) {
        if (k.startsWith(evt.sessionId + ':')) state.agents.delete(k);
      }
      break;
    }
    case 'agent-start': {
      const a = ensureAgent(state, evt.sessionId, evt.agentName);
      // Only enter walking_to_desk if we're not already seated or en route.
      if (a.state !== 'working' && a.state !== 'walking_to_desk') {
        a.state = 'walking_to_desk';
      }
      a.lastEventAt = evt.timestamp;
      break;
    }
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
    case 'agent-tool-end': {
      const a = ensureAgent(state, evt.sessionId, evt.agentName);
      a.lastEventAt = evt.timestamp;
      a.history = a.history.map((h) =>
        h.id === evt.toolCallId ? { ...h, endedAt: evt.timestamp, status: evt.status } : h
      );
      // If the current tool is the one ending, clear it
      const stillRunning = a.history.filter((h) => h.status === 'running');
      if (stillRunning.length > 0) {
        const last = stillRunning[stillRunning.length - 1];
        a.currentTool = last.tool;
        a.currentInputSummary = last.inputSummary;
      } else {
        a.currentTool = undefined;
        a.currentInputSummary = undefined;
      }
      break;
    }
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
    case 'agent-stop': {
      const a = ensureAgent(state, evt.sessionId, evt.agentName);
      a.state = 'idle';
      a.currentTool = undefined;
      a.currentInputSummary = undefined;
      a.lastEventAt = evt.timestamp;
      break;
    }
  }
  return state;
}
