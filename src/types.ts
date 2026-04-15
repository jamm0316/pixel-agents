export type AgentDef = {
  name: string;
  description?: string;
  model?: string;
};

export type SessionInfo = {
  sessionId: string;
  cwd: string;
  projectName: string;
  squad: AgentDef[];
  createdAt: number;
  updatedAt: number;
};

export type ToolCall = {
  id: string;
  tool: string;
  inputSummary: string;
  startedAt: number;
  endedAt?: number;
  status: 'running' | 'done' | 'error';
};

export type AgentUiState = {
  name: string;
  description?: string;
  state: 'idle' | 'walking_to_desk' | 'working' | 'walking_home';
  currentTool?: string;
  currentInputSummary?: string;
  lastEventAt: number;
  history: ToolCall[];
};

export type PermissionRequest = {
  requestId: string;
  sessionId: string;
  agentName: string;
  tool: string;
  inputSummary: string;
  createdAt: number;
};

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
