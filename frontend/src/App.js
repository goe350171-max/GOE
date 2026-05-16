import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { SolanaProvider } from './contexts/SolanaProvider';
import { Toaster } from './components/ui/sonner';
import ErrorBoundary from './components/ErrorBoundary';
import Header from './components/Header';
import Launchpad from './pages/Launchpad';
import Explorer from './pages/Explorer';
import Airdrop from './pages/Airdrop';
import './App.css';

function App() {
  return (
    <ErrorBoundary>
      <SolanaProvider>
        <BrowserRouter>
          <div className="App min-h-screen bg-background">
            <Header />
            <main>
              <Routes>
                <Route path="/" element={<Launchpad />} />
                <Route path="/explorer" element={<Explorer />} />
                <Route path="/airdrop" element={<Airdrop />} />
              </Routes>
            </main>
            <Toaster position="top-right" />
          </div>
        </BrowserRouter>
      </SolanaProvider>
    </ErrorBoundary>
  );
}

export default App;
