/**
 * Error Boundary Components
 * 
 * React error boundaries wrapping each Aegis view.
 * Catches render errors and displays a graceful fallback UI.
 */

'use client';

import React, { Component } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  viewName?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class AegisErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(`[Aegis Error Boundary${this.props.viewName ? ` - ${this.props.viewName}` : ''}]`, error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              {this.props.viewName ? `${this.props.viewName} Error` : 'Something went wrong'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              An unexpected error occurred while rendering this view. This may be due to a network issue or invalid data from the blockchain.
            </p>
            {this.state.error && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer font-medium mb-1">Error details</summary>
                <code className="block p-2 rounded bg-muted overflow-auto break-all">
                  {this.state.error.message}
                </code>
              </details>
            )}
            <Button onClick={this.handleRetry} variant="outline" size="sm" className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Try again
            </Button>
          </CardContent>
        </Card>
      );
    }

    return this.props.children;
  }
}

/**
 * Route-level error fallback for Next.js error.tsx
 */
export function RouteErrorFallback({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex items-center justify-center min-h-[60vh] p-8">
      <Card className="max-w-md w-full border-destructive/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Dashboard Error
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            The Aegis dashboard encountered an error. This may be a temporary issue with the Flare RPC connection or the FCC extension proxy.
          </p>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium mb-1">Technical details</summary>
            <code className="block p-2 rounded bg-muted overflow-auto break-all">
              {error.message}
            </code>
          </details>
          <div className="flex gap-2">
            <Button onClick={reset} size="sm" className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
            <Button onClick={() => window.location.reload()} variant="outline" size="sm">
              Reload page
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
