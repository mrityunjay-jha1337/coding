import type { ErrorInfo, ReactNode } from 'react';
import { Component } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI error boundary caught an error', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="centered-screen">
          <div className="surface-card auth-card">
            <div className="eyebrow">Application Error</div>
            <h1>Something broke in the client</h1>
            <p className="muted-copy">
              Refresh the page. If the issue persists, inspect the browser console and the server logs.
            </p>
            <button className="btn btn-primary" onClick={() => window.location.reload()}>
              Reload application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
