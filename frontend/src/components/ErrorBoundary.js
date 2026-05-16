import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] Captured:', error, errorInfo);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          data-testid="error-boundary"
          className="min-h-screen flex items-center justify-center bg-zinc-50 px-6"
        >
          <div className="max-w-lg w-full bg-white border border-zinc-300 p-8">
            <div className="text-xs uppercase tracking-wider font-semibold text-red-700 mb-2">
              Application Error
            </div>
            <h1 className="text-3xl font-black tracking-tighter mb-4">Something broke</h1>
            <p className="text-sm text-zinc-700 mb-6">
              An unexpected error occurred. Your wallet and on-chain assets are safe — this is only a UI issue.
            </p>
            {this.state.error && (
              <pre className="text-xs bg-zinc-50 border border-zinc-200 p-3 overflow-auto max-h-40 mb-6 font-mono text-zinc-700">
                {String(this.state.error?.message || this.state.error)}
              </pre>
            )}
            <button
              data-testid="error-boundary-reload"
              onClick={this.handleReload}
              className="w-full bg-black text-white hover:bg-zinc-800 rounded-none h-11 font-bold tracking-wide"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
