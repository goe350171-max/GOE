import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

/**
 * Lightweight diagnostics bus. Hooks push stage events here;
 * a UI panel can subscribe and render them. Disabled in production
 * unless REACT_APP_DEBUG_TOKEN_CREATE === 'true' (default true in this build).
 */

const DiagnosticsContext = createContext(null);

const MAX_EVENTS = 100;

export const DiagnosticsProvider = ({ children }) => {
  const [events, setEvents] = useState([]);
  const seqRef = useRef(0);

  const push = useCallback((stage, status, data = null) => {
    seqRef.current += 1;
    const evt = {
      seq: seqRef.current,
      timestamp: new Date().toISOString(),
      stage,
      status, // 'start' | 'ok' | 'fail'
      data,
    };
    setEvents((prev) => {
      const next = [...prev, evt];
      if (next.length > MAX_EVENTS) next.shift();
      return next;
    });
    return evt;
  }, []);

  const clear = useCallback(() => {
    seqRef.current = 0;
    setEvents([]);
  }, []);

  return (
    <DiagnosticsContext.Provider value={{ events, push, clear }}>
      {children}
    </DiagnosticsContext.Provider>
  );
};

export const useDiagnostics = () => {
  const ctx = useContext(DiagnosticsContext);
  // Allow hooks to call push() even when no provider is mounted (no-op).
  if (!ctx) {
    return {
      events: [],
      push: () => null,
      clear: () => {},
    };
  }
  return ctx;
};

export default DiagnosticsContext;
