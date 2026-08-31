import React, { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Error boundary for Recharts components.
 * Catches "rect/path undefined" and other Recharts rendering errors
 * that occur when charts are rendered before container dimensions are available.
 */
export class ChartErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(_: Error): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Only log in development
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[ChartErrorBoundary] Chart render failed:', error.message);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
            Unable to render chart
          </div>
        )
      );
    }

    return this.props.children;
  }
}
