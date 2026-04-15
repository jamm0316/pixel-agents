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

export type AgentActivity = {
  state: 'idle' | 'working';
  currentTool?: string;
  currentInputSummary?: string;
  lastEventAt: number;
  history: ToolCall[];
};

export type ToolCall = {
  id: string;
  tool: string;
  inputSummary: string;
  startedAt: number;
  endedAt?: number;
  status: 'running' | 'done' | 'error';
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
  | { kind: 'session-open'; session: SessionInfo }
  | { kind: 'session-close'; sessionId: string }
  | { kind: 'agent-start'; sessionId: string; agentName: string; tool: string; inputSummary: string; toolCallId: string; timestamp: number }
  | { kind: 'agent-tool'; sessionId: string; agentName: string; tool: string; inputSummary: string; toolCallId: string; timestamp: number }
  | { kind: 'agent-tool-end'; sessionId: string; agentName: string; toolCallId: string; status: 'done' | 'error'; timestamp: number }
  | { kind: 'agent-stop'; sessionId: string; agentName: string; timestamp: number }
  | { kind: 'permission-request'; req: PermissionRequest }
  | { kind: 'permission-resolved'; requestId: string; decision: 'allow' | 'deny' }
  | { kind: 'snapshot'; sessions: SessionInfo[]; pending: PermissionRequest[] };
