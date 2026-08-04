/**
 * Route-level error boundary for the Aegis Dashboard
 * 
 * Catches unhandled errors and displays a graceful fallback.
 */

'use client';

import { RouteErrorFallback } from '@/components/aegis/error-boundary';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteErrorFallback error={error} reset={reset} />;
}
