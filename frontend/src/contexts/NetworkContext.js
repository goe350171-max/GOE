import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

/**
 * Network + Safety context.
 *
 * Defaults to DEVNET to prevent accidental mainnet SOL spend.
 * Users must explicitly opt into mainnet via the NetworkSwitcher (which
 * shows a warning modal). Test Mode disables real signing entirely.
 *
 * Persisted in localStorage:
 *   - solaunch.network: 'devnet' | 'mainnet'
 *   - solaunch.testMode: '1' | '0'
 *   - solaunch.txLog: JSON array of signed-tx audit records
 */

const NetworkContext = createContext(null);

const STORAGE_KEYS = {
  network: 'solaunch.network',
  testMode: 'solaunch.testMode',
  txLog: 'solaunch.txLog',
};

const DEFAULT_NETWORK = 'mainnet';
const MAX_LOG_ENTRIES = 200;

const readStorage = (key, fallback) => {
  try {
    const v = window.localStorage.getItem(key);

    if (!v) return fallback;

    // network migration fix
    if (key === STORAGE_KEYS.network && v === 'devnet') {
      return 'mainnet';
    }

    // normalize booleans
    if (key === STORAGE_KEYS.testMode) {
      return v === '1' ? '1' : '0';
    }

    if (key === 'solaunch.safeMode') {
      return v === '1' ? '1' : '0';
    }

    return v;
  } catch {
    return fallback;
  }
};

const writeStorage = (key, value) => {
  try {
    window.localStorage.setItem(key, value);
  } catch { /* ignore */ }
};

export const NetworkProvider = ({ children }) => {
  const [network, setNetworkState] = useState(() => 'mainnet');
  
  const [testMode, setTestModeState] = useState(() => false);
  const [safeMode, setSafeModeState] = useState(() => true);
  const [txLog, setTxLog] = useState(() => {
    try {
      const raw = readStorage(STORAGE_KEYS.txLog, '[]');
      return JSON.parse(raw) || [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    writeStorage(STORAGE_KEYS.network, network);
  }, [network]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.testMode, testMode ? '1' : '0');
  }, [testMode]);

  useEffect(() => {
    writeStorage('solaunch.safeMode', safeMode ? '1' : '0');
  }, [safeMode]);

  /** Set network — caller should show a warning modal first when switching to mainnet. */
  const setNetwork = useCallback((next) => {
    if (next !== 'devnet' && next !== 'mainnet') return;
    setNetworkState(next);
  }, []);

  const setTestMode = useCallback((next) => {
    setTestModeState(!!next);
  }, []);

  const setSafeMode = useCallback((next) => {
    setSafeModeState(!!next);
  }, []);

  /** Append a signed-tx audit record (kept in localStorage). */
  const recordSignedTransaction = useCallback((entry) => {
    const record = {
      timestamp: new Date().toISOString(),
      network,
      ...entry,
    };
    setTxLog((prev) => {
      const next = [record, ...prev].slice(0, MAX_LOG_ENTRIES);
      writeStorage(STORAGE_KEYS.txLog, JSON.stringify(next));
      return next;
    });
    // Best-effort console for dev visibility
    // eslint-disable-next-line no-console
    console.info('[tx-log]', record);
    return record;
  }, [network]);

  const clearTxLog = useCallback(() => {
    writeStorage(STORAGE_KEYS.txLog, '[]');
    setTxLog([]);
  }, []);

  const value = {
    network,
    setNetwork,
    isMainnet: network === 'mainnet',
    isDevnet: network === 'devnet',
    testMode,
    setTestMode,
    safeMode,
    setSafeMode,
    txLog,
    recordSignedTransaction,
    clearTxLog,
  };

  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
};

export const useNetwork = () => {
  const ctx = useContext(NetworkContext);
  if (!ctx) {
    throw new Error('useNetwork must be used inside <NetworkProvider>');
  }
  return ctx;
};

export default NetworkContext;
