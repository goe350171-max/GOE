import React, { useState } from 'react';
import { useDiagnostics } from '../contexts/DiagnosticsContext';
import { CaretDown, CaretUp, X, ClipboardText, CheckCircle, XCircle, CircleNotch } from '@phosphor-icons/react';
import { Button } from './ui/button';
import { copyText } from '../utils/clipboard';
import { toast } from 'sonner';

const DEBUG = (process.env.REACT_APP_DEBUG_TOKEN_CREATE ?? 'true') !== 'false';

/**
 * Visible diagnostics panel. Shows the live token-create stage stream so
 * users (and devs) can pinpoint exactly which stage failed without opening
 * the browser console. Mounts only when REACT_APP_DEBUG_TOKEN_CREATE is on.
 */
const DiagnosticsPanel = () => {
  const { events, clear } = useDiagnostics();
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);

  if (!DEBUG || hidden) return null;

  const failedEvent = [...events].reverse().find((e) => e.status === 'fail');
  const lastEvent = events[events.length - 1];
  const hasFail = !!failedEvent;
  const hasEvents = events.length > 0;

  const copyAll = async () => {
    const dump = events
      .map((e) => `[${e.seq}] ${e.timestamp} ${e.stage} ${e.status} ${e.data ? JSON.stringify(e.data) : ''}`)
      .join('\n');
    const ok = await copyText(dump || 'No events recorded yet');
    if (ok) toast.success('Diagnostics copied');
    else toast.error('Copy failed');
  };

  return (
    <div
      data-testid="diagnostics-panel"
      className="fixed bottom-4 right-4 z-40 w-[420px] max-w-[95vw] bg-white border-2 border-zinc-300 shadow-[6px_6px_0_0_rgba(0,0,0,0.85)]"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        data-testid="diagnostics-toggle"
        className={`w-full flex items-center justify-between px-3 py-2 text-left ${
          hasFail ? 'bg-red-600 text-white' : hasEvents ? 'bg-black text-white' : 'bg-zinc-200 text-zinc-700'
        }`}
      >
        <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
          {hasFail ? <XCircle size={14} weight="fill" /> : hasEvents ? <CheckCircle size={14} weight="bold" /> : <CircleNotch size={14} weight="bold" />}
          Diagnostics
          {hasEvents && <span className="text-[10px] opacity-80">· {events.length} events</span>}
          {hasFail && <span className="text-[10px]">· FAIL at {failedEvent.stage}</span>}
        </span>
        <span className="flex items-center gap-1">
          {open ? <CaretDown size={14} weight="bold" /> : <CaretUp size={14} weight="bold" />}
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); setHidden(true); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setHidden(true); } }}
            data-testid="diagnostics-close"
            className="ml-1 hover:opacity-80"
          >
            <X size={14} weight="bold" />
          </span>
        </span>
      </button>

      {open && (
        <div data-testid="diagnostics-body">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-200 bg-zinc-50">
            <Button
              type="button"
              variant="outline"
              onClick={copyAll}
              data-testid="diagnostics-copy"
              className="rounded-none h-7 text-[11px] px-2"
            >
              <ClipboardText size={12} weight="bold" className="mr-1" /> Copy all
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={clear}
              data-testid="diagnostics-clear"
              className="rounded-none h-7 text-[11px] px-2"
            >
              Clear
            </Button>
            {lastEvent && (
              <span className="text-[10px] text-zinc-500 ml-auto font-mono">
                last: {lastEvent.stage} · {lastEvent.status}
              </span>
            )}
          </div>

          <div className="max-h-72 overflow-auto bg-zinc-950 text-zinc-100 px-3 py-2 text-[11px] font-mono leading-snug">
            {events.length === 0 && (
              <div className="text-zinc-500">No events yet. Trigger Create Token to populate.</div>
            )}
            {events.map((e) => (
              <div
                key={e.seq}
                data-testid={`diag-event-${e.seq}`}
                className={`flex items-start gap-2 py-0.5 border-b border-zinc-800 ${
                  e.status === 'fail' ? 'text-red-400' : e.status === 'ok' ? 'text-green-300' : 'text-zinc-200'
                }`}
              >
                <span className="text-zinc-500 w-6 flex-shrink-0">#{e.seq}</span>
                <span className="font-bold w-24 flex-shrink-0">{e.stage}</span>
                <span className="w-10 flex-shrink-0 uppercase">{e.status}</span>
                <span className="break-all">
                  {e.data ? JSON.stringify(e.data) : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default DiagnosticsPanel;
