import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Top-level error boundary that catches React render crashes
 * and displays a recovery UI instead of a blank white page.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: '100vh', background: '#1a1a2e', color: '#e8e8e8',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}>
          <div style={{ textAlign: 'center', maxWidth: 480, padding: 24 }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Something went wrong</div>
            <div style={{ fontSize: 13, color: '#8888aa', marginBottom: 16, lineHeight: 1.6 }}>
              {this.state.error.message}
            </div>
            <div style={{ fontSize: 13, color: '#6b6b8a', marginBottom: 20 }}>
              This can happen when loading a scenario file saved with an older version.
            </div>
            <button
              onClick={() => {
                this.setState({ error: null });
                window.location.reload();
              }}
              style={{
                padding: '8px 20px', background: '#4a6fa5', color: '#fff',
                border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13,
              }}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
