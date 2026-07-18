import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportBoundaryError } from '../lib/monitoring';

interface Props {
  fallback: ReactNode;
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Lichtgewicht error boundary — vangt render-crashes op, toont een fallback
 * en meldt de fout aan de eigen monitoring (POST /api/client-errors). Vervangt
 * Sentry.ErrorBoundary zodat @sentry/react volledig uit de bundel kan.
 *
 * props/state worden expliciet gedeclareerd: dit project heeft geen
 * @types/react geïnstalleerd, dus de generieke Component-basis levert ze niet.
 */
export class ErrorBoundary extends Component<Props, State> {
  declare props: Props;
  declare state: State;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportBoundaryError(error, info.componentStack ?? undefined);
  }

  render(): ReactNode {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}
