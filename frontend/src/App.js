import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';

import { NetworkProvider } from './contexts/NetworkContext';
import { DiagnosticsProvider } from './contexts/DiagnosticsContext';
import { SolanaProvider } from './contexts/SolanaProvider';

import { Toaster } from './components/ui/sonner';
import ErrorBoundary from './components/ErrorBoundary';
import MainnetWarningBanner from './components/MainnetWarningBanner';
import DiagnosticsPanel from './components/DiagnosticsPanel';
import Header from './components/Header';
import Sidebar from './components/Sidebar';

import Launchpad from './pages/Launchpad';
import Explorer from './pages/Explorer';
import Airdrop from './pages/Airdrop';
import PhantomTest from './pages/PhantomTest';

import './App.css';

function App() {
  return (
    <ErrorBoundary>
      <NetworkProvider>
        <DiagnosticsProvider>
          <SolanaProvider>
            <BrowserRouter>
              <div className="App min-h-screen bg-background">
                <MainnetWarningBanner />

                <Header />

                <div className="flex">
                  <Sidebar />

                  <main className="flex-1">
                    <Routes>
                      <Route path="/" element={<Launchpad />} />
                      <Route path="/explorer" element={<Explorer />} />
                      <Route path="/airdrop" element={<Airdrop />} />
                      <Route path="/phantom-test" element={<PhantomTest />} />

                      {/* Optional: keep this while debugging */}
                      <Route path="/launchpad-test" element={<Launchpad />} />
                    </Routes>
                  </main>
                </div>

                <DiagnosticsPanel />
                <Toaster position="top-right" />
              </div>
            </BrowserRouter>
          </SolanaProvider>
        </DiagnosticsProvider>
      </NetworkProvider>
    </ErrorBoundary>
  );
}

export default App;
