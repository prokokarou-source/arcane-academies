import { Component, type ReactNode } from 'react';
import { en } from '../i18n/strings';

interface Props {
  children: ReactNode;
  onError?: (err: unknown) => void;
  onReload?: () => void;
}

/**
 * Last line of defence: a rendering crash shows a friendly screen with Reload instead of a blank page.
 * It sits outside every provider, so it reads the English table directly instead of useT().
 */
export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(err: unknown) {
    this.props.onError?.(err);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="screen center crash" role="alert">
        <span className="crash-mark" aria-hidden="true">
          ✦
        </span>
        <h2>{en.crashTitle}</h2>
        <p className="muted">{en.crashBody}</p>
        <button className="primary" onClick={this.props.onReload ?? (() => location.reload())}>
          {en.reload}
        </button>
      </main>
    );
  }
}
