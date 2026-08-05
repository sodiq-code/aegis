/**
 * Xaman (Xumm) Wallet Integration
 *
 * Real XRPL wallet connection via Xaman SDK. Falls back to manual address
 * entry when XAMM_API_KEY is not configured on the server.
 *
 * Production flow:
 *   1. User clicks "Connect Xaman"
 *   2. POST /api/xaman-sign creates a sign request via xumm-sdk (server-side)
 *   3. Server returns { qrUrl, wsUrl, sessionId }
 *   4. Frontend shows QR code; user scans with Xaman app
 *   5. Frontend polls /api/xaman-sign?sessionId=X for resolved status
 *   6. On resolve, the user's XRPL address is stored in wallet state
 *
 * Manual fallback (no XAMM_API_KEY):
 *   1. User clicks "Connect Xaman (manual)"
 *   2. Frontend shows a text input for the XRPL address
 *   3. User pastes their Xaman XRPL address (r...)
 *   4. Frontend stores the address in wallet state (no signature verification)
 *
 * Reference: https://xumm.readme.io/
 */

'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useWalletStore } from './wallet-auth';

export interface XamanSession {
  sessionId: string;
  qrUrl: string;        // QR code image URL (data: or https:)
  wsUrl: string;         // WebSocket URL for real-time status
  nextUrl?: string;      // Xaman deep link (xumm://...)
  expiresAt: number;
}

export interface XamanConnectionState {
  mode: 'idle' | 'qr' | 'manual' | 'connected' | 'error';
  session: XamanSession | null;
  address: string | null;
  error: string | null;
  isPolling: boolean;
}

/**
 * Hook for Xaman wallet connection.
 * Tries the real Xaman SDK first; falls back to manual mode.
 */
export function useXamanConnection() {
  const [state, setState] = useState<XamanConnectionState>({
    mode: 'idle',
    session: null,
    address: null,
    error: null,
    isPolling: false,
  });
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
    setState(s => ({ ...s, isPolling: false }));
  }, []);

  /**
   * Start a real Xaman sign request (requires server-side XAMM_API_KEY).
   */
  const connectWithQr = useCallback(async () => {
    setState(s => ({ ...s, mode: 'qr', error: null }));
    try {
      // POST /api/xaman-sign to create a sign request
      const resp = await fetch('/api/xaman-sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'connect' }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      const data = await resp.json();

      // If the server doesn't have a Xaman API key, it returns { mode: 'manual' }
      if (data.mode === 'manual') {
        setState(s => ({
          ...s,
          mode: 'manual',
          error: 'Xaman API key not configured on server. Enter your XRPL address manually.',
        }));
        return;
      }

      const session: XamanSession = {
        sessionId: data.sessionId,
        qrUrl: data.qrUrl,
        wsUrl: data.wsUrl,
        nextUrl: data.nextUrl,
        expiresAt: Date.now() + (data.expiresInSec || 300) * 1000,
      };
      setState(s => ({ ...s, session, isPolling: true }));

      // Start polling for resolution
      const poll = async () => {
        try {
          const statusResp = await fetch(`/api/xaman-sign?sessionId=${session.sessionId}`);
          const status = await statusResp.json();
          if (status.resolved && status.address) {
            // Connected!
            setState(s => ({
              ...s,
              mode: 'connected',
              address: status.address,
              isPolling: false,
              session: null,
            }));
            // Update the global wallet store
            useWalletStore.setState({
              type: 'xrpl',
              status: 'connected',
              address: status.address,
              chainId: null,
              balance: status.balance || null,
              role: 'depositor',
              error: null,
            });
            return;
          }
          if (status.expired) {
            setState(s => ({
              ...s,
              mode: 'error',
              error: 'Xaman sign request expired',
              isPolling: false,
              session: null,
            }));
            return;
          }
          // Schedule next poll
          pollTimer.current = setTimeout(poll, 2000);
        } catch (e) {
          setState(s => ({
            ...s,
            mode: 'error',
            error: e instanceof Error ? e.message : 'Poll failed',
            isPolling: false,
          }));
        }
      };
      poll();
    } catch (e) {
      setState(s => ({
        ...s,
        mode: 'error',
        error: e instanceof Error ? e.message : 'Failed to start Xaman session',
      }));
    }
  }, []);

  /**
   * Connect with a manually-entered XRPL address (no signature).
   */
  const connectManual = useCallback((address: string) => {
    // Basic XRPL address validation (r... and 25-35 chars)
    if (!address.match(/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/)) {
      setState(s => ({ ...s, mode: 'error', error: 'Invalid XRPL address' }));
      return false;
    }
    setState({
      mode: 'connected',
      session: null,
      address,
      error: null,
      isPolling: false,
    });
    useWalletStore.setState({
      type: 'xrpl',
      status: 'connected',
      address,
      chainId: null,
      balance: null,
      role: 'depositor',
      error: null,
    });
    return true;
  }, []);

  const disconnect = useCallback(() => {
    stopPolling();
    setState({
      mode: 'idle',
      session: null,
      address: null,
      error: null,
      isPolling: false,
    });
    useWalletStore.setState({
      type: null,
      status: 'disconnected',
      address: null,
      chainId: null,
      balance: null,
      role: 'depositor',
      error: null,
    });
  }, [stopPolling]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, []);

  return {
    ...state,
    connectWithQr,
    connectManual,
    disconnect,
    stopPolling,
  };
}
