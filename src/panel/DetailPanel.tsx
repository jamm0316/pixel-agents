import React from 'react';
import type { AgentUiState, SessionInfo } from '../types';
import { formatHistoryLine } from '../game/korean';

type Props = {
  session: SessionInfo | null;
  agent: AgentUiState | null;
  onClear: () => void;
};

export function DetailPanel({ session, agent, onClear }: Props) {
  if (!session || !agent) {
    return (
      <div style={{ padding: 14, color: '#7d8596', fontSize: 12, lineHeight: 1.6 }}>
        <div style={{ fontWeight: 700, color: '#b8bfcc', marginBottom: 8, letterSpacing: 1 }}>
          INSPECTOR
        </div>
        <div>캐릭터를 클릭하면 상세 정보를 볼 수 있습니다.</div>
        <div style={{ marginTop: 16, fontSize: 11 }}>
          <div style={{ color: '#5c6272' }}>● 스쿼드는 .claude/agents/*.md 파일에서 로드됩니다.</div>
          <div style={{ color: '#5c6272' }}>● 메인 에이전트는 항상 "main"으로 표시됩니다.</div>
          <div style={{ color: '#5c6272' }}>● 서브에이전트는 Task 툴로 소환되는 것들입니다.</div>
        </div>
      </div>
    );
  }

  const last = agent.history.slice().reverse();

  return (
    <div style={{ padding: 14, fontSize: 12, color: '#d7d9de', height: '100%', overflow: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontWeight: 700, letterSpacing: 1, color: '#b8bfcc' }}>INSPECTOR</div>
        <button
          onClick={onClear}
          style={{
            background: 'transparent',
            border: '1px solid #2a2f3a',
            color: '#7d8596',
            fontSize: 10,
            padding: '2px 6px',
            borderRadius: 3,
            cursor: 'pointer',
          }}
        >
          ✕ 닫기
        </button>
      </div>

      <div style={{ marginTop: 12, fontWeight: 700, fontSize: 14 }}>{agent.name}</div>
      <div style={{ fontSize: 10, color: '#7d8596' }}>{session.projectName}</div>
      {agent.description && (
        <div style={{ marginTop: 8, fontSize: 11, color: '#a7adba', lineHeight: 1.55 }}>
          {agent.description}
        </div>
      )}

      <div
        style={{
          marginTop: 12,
          padding: '6px 8px',
          background: '#1c2030',
          border: '1px solid #262b3a',
          borderRadius: 4,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span style={{ fontSize: 10, color: '#7d8596', letterSpacing: 1 }}>STATUS</span>
        <span
          style={{
            color: agent.state === 'working' ? '#ffd84a' : '#5ee38b',
            fontWeight: 700,
          }}
        >
          {agent.state === 'working' ? '● WORKING' : '○ IDLE'}
        </span>
      </div>

      {agent.currentTool && (
        <div
          style={{
            marginTop: 10,
            padding: 8,
            background: '#2c2819',
            border: '1px solid #443a20',
            borderRadius: 4,
          }}
        >
          <div style={{ fontSize: 10, color: '#bfa46f', letterSpacing: 1 }}>CURRENT TOOL</div>
          <div style={{ fontWeight: 700, marginTop: 2 }}>{agent.currentTool}</div>
          {agent.currentInputSummary && (
            <div
              style={{
                marginTop: 4,
                fontSize: 10,
                color: '#e0d199',
                wordBreak: 'break-all',
              }}
            >
              {agent.currentInputSummary}
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 14, fontSize: 10, color: '#7d8596', letterSpacing: 1 }}>
        HISTORY ({last.length})
      </div>
      <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {last.map((h) => (
          <div
            key={h.id}
            style={{
              padding: '5px 7px',
              background: h.status === 'running' ? '#2a2f1e' : '#1a1d25',
              borderLeft: `2px solid ${
                h.status === 'error' ? '#ff7b7b' : h.status === 'running' ? '#ffd84a' : '#5ee38b'
              }`,
              fontSize: 11,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
              <span style={{ color: '#e0e4ec', wordBreak: 'break-all' }}>
                {formatHistoryLine(h.tool, h.inputSummary)}
              </span>
              <span style={{ color: '#5c6272', whiteSpace: 'nowrap' }}>
                {h.endedAt ? `${Math.round((h.endedAt - h.startedAt) / 10) / 100}s` : '…'}
              </span>
            </div>
            <div style={{ fontSize: 9, color: '#5c6272' }}>{h.tool}</div>
          </div>
        ))}
        {last.length === 0 && (
          <div style={{ color: '#5c6272', fontSize: 10 }}>아직 활동 없음</div>
        )}
      </div>
    </div>
  );
}
