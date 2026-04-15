import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { StreamEvent } from './types';
import { applyEvent, initialState, key, type AppState } from './store';
import { createPixiApp, type PixiAppHandle } from './game/PixiApp';
import { DetailPanel } from './panel/DetailPanel';

function reducer(state: AppState, action: StreamEvent | { kind: 'select'; sel: AppState['selected'] }): AppState {
  if (action.kind === 'select') return { ...state, selected: action.sel };
  return applyEvent(state, action as StreamEvent);
}

const zoomBtnStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 14,
  lineHeight: 1,
  color: '#e6e9f0',
  background: '#2a2f3a',
  border: '1px solid #3a3f4a',
  borderRadius: 3,
  cursor: 'pointer',
  padding: 0,
};

async function respondPermission(
  requestId: string,
  decision: 'allow' | 'deny' | 'always'
) {
  try {
    await fetch('/api/permission-response', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, decision }),
    });
  } catch {}
}

export function App() {
  const [state, dispatch] = useReducer(reducer, null, initialState);
  const hostRef = useRef<HTMLDivElement>(null);
  const pixiRef = useRef<PixiAppHandle | null>(null);
  const [connected, setConnected] = useState(false);
  const [zoom, setZoom] = useState(1);

  // Boot pixi
  useEffect(() => {
    let handle: PixiAppHandle | null = null;
    let cancelled = false;
    (async () => {
      if (!hostRef.current) return;
      handle = await createPixiApp(hostRef.current);
      if (cancelled) {
        handle.destroy();
        return;
      }
      pixiRef.current = handle;
      setZoom(handle.getZoom());
      handle.onSelect((sel) => dispatch({ kind: 'select', sel }));
      handle.onPermissionChoice((id, decision) => respondPermission(id, decision));
    })();
    return () => {
      cancelled = true;
      handle?.destroy();
      pixiRef.current = null;
    };
  }, []);

  // SSE
  useEffect(() => {
    const es = new EventSource('/stream');
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (m) => {
      try {
        const evt: StreamEvent = JSON.parse(m.data);
        dispatch(evt);
      } catch {}
    };
    return () => es.close();
  }, []);

  // Sync state to pixi
  useEffect(() => {
    if (!pixiRef.current) return;
    pixiRef.current.sync([...state.sessions.values()], state.agents, state.pending);
    pixiRef.current.setSelected(state.selected);
  }, [state]);

  const selectedAgent = useMemo(() => {
    if (!state.selected) return null;
    return state.agents.get(key(state.selected.sessionId, state.selected.agentName)) ?? null;
  }, [state.selected, state.agents]);
  const selectedSession = useMemo(() => {
    if (!state.selected) return null;
    return state.sessions.get(state.selected.sessionId) ?? null;
  }, [state.selected, state.sessions]);

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
        <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />
        <div
          style={{
            position: 'absolute',
            left: 12,
            top: 8,
            padding: '2px 8px',
            fontSize: 11,
            background: '#1a1d25cc',
            border: '1px solid #2a2f3a',
            borderRadius: 4,
            display: 'flex',
            gap: 10,
            alignItems: 'center',
          }}
        >
          <span style={{ fontWeight: 700, letterSpacing: 1 }}>PIXEL AGENTS</span>
          <span style={{ opacity: 0.6 }}>|</span>
          <span style={{ color: connected ? '#5ee38b' : '#ff7b7b' }}>
            ● {connected ? 'LIVE' : 'OFFLINE'}
          </span>
          <span style={{ opacity: 0.6 }}>|</span>
          <span style={{ opacity: 0.85 }}>{state.sessions.size} rooms</span>
          {state.pending.size > 0 && (
            <>
              <span style={{ opacity: 0.6 }}>|</span>
              <span style={{ color: '#ffd84a' }}>⚠ {state.pending.size} 대기</span>
            </>
          )}
        </div>
        <div
          style={{
            position: 'absolute',
            left: 12,
            bottom: 12,
            display: 'flex',
            gap: 4,
            alignItems: 'center',
            padding: '4px 6px',
            background: '#1a1d25cc',
            border: '1px solid #2a2f3a',
            borderRadius: 4,
            fontSize: 11,
            zIndex: 10,
          }}
        >
          <button
            onClick={() => {
              pixiRef.current?.zoomOut();
              if (pixiRef.current) setZoom(pixiRef.current.getZoom());
            }}
            style={zoomBtnStyle}
            aria-label="축소"
          >
            −
          </button>
          <span style={{ minWidth: 36, textAlign: 'center', opacity: 0.85 }}>
            {zoom.toFixed(2)}×
          </span>
          <button
            onClick={() => {
              pixiRef.current?.zoomIn();
              if (pixiRef.current) setZoom(pixiRef.current.getZoom());
            }}
            style={zoomBtnStyle}
            aria-label="확대"
          >
            +
          </button>
        </div>
      </div>
      <div
        style={{
          width: 340,
          borderLeft: '1px solid #1f2230',
          background: '#141720',
          overflow: 'hidden',
        }}
      >
        <DetailPanel
          session={selectedSession}
          agent={selectedAgent}
          onClear={() => dispatch({ kind: 'select', sel: null })}
        />
      </div>
    </div>
  );
}
