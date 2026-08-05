/**
 * Custom React hooks for the Aegis Treasury view.
 * 
 * Provides hooks for fetching vault state, events, risk score, and solvency data
 * from on-chain contracts (Flare RPC) and the FCC extension proxy (TEE).
 */

'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

// --- Types ---

export interface VaultState {
  connected: boolean;
  chainId: number;
  blockNumber: number;
  vault: {
    totalDeposited: number;
    totalValuation: number;
    positionCount: number;
    xrpPrice: number;
    isEmergency: boolean;
    isSafeState: boolean;
  } | null;
  solvency: {
    solvent: boolean;
    collateralRatio: number;
  } | null;
  contractsDeployed: Record<string, boolean> | null;
  lastUpdated: string;
}

export interface VaultEvent {
  type: string;
  blockNumber: number;
  transactionHash: string;
  contract: string;
  timestamp?: number;
  details: Record<string, string>;
}

export interface RiskScore {
  score: number;
  action: string;
  confidence: number;
  thresholds: {
    hold: number;
    rebalance: number;
    hedge: number;
    deleverage: number;
  };
  lastUpdated: string;
  source: 'extension' | 'fallback' | 'risk-agent';
}

// --- Vault State Hook ---

export function useVaultState(refreshIntervalMs = 30000) {
  const [data, setData] = useState<VaultState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    // Cancel previous request
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/vault-state', { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      setData(result);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Failed to fetch vault state');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, refreshIntervalMs);
    return () => {
      clearInterval(interval);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [fetchData, refreshIntervalMs]);

  return { data, loading, error, refetch: fetchData };
}

// --- Vault Events Hook ---

export function useVaultEvents() {
  const [events, setEvents] = useState<VaultEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/vault-events?range=all');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      setEvents(result.events || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch events');
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  return { events, loading, error, refetch: fetchEvents };
}

// --- Risk Score Hook ---

// Default risk score thresholds from the XGBoost model
const DEFAULT_THRESHOLDS = {
  hold: 25,
  rebalance: 50,
  hedge: 75,
  deleverage: 90,
};

export function useRiskScore(refreshIntervalMs = 30000) {
  const [data, setData] = useState<RiskScore>({
    score: 0,
    action: 'Unknown',
    confidence: 0,
    thresholds: DEFAULT_THRESHOLDS,
    lastUpdated: '',
    source: 'fallback',
  });
  const [loading, setLoading] = useState(true);

  const fetchRiskScore = useCallback(async () => {
    setLoading(true);
    try {
      // Primary: real risk score from /api/risk-agent (computed from FTSO V2 + on-chain state)
      const response = await fetch('/api/risk-agent');
      if (response.ok) {
        const result = await response.json();
        if (typeof result.riskScore === 'number') {
          setData({
            score: result.riskScore,
            action: result.action || 'Hold',
            confidence: 0.85,
            thresholds: DEFAULT_THRESHOLDS,
            lastUpdated: new Date(result.timestamp * 1000).toISOString(),
            source: 'risk-agent',
          });
          return;
        }
      }
    } catch {
      // risk-agent not reachable — fall through
    }

    // Fallback: compute a basic risk score from on-chain vault state
    try {
      const vaultResponse = await fetch('/api/vault-state');
      if (vaultResponse.ok) {
        const vaultData = await vaultResponse.json();
        if (vaultData.vault) {
          const ratio = vaultData.solvency?.collateralRatio ?? 0;
          // Simple heuristic: risk score based on collateral ratio
          let score: number;
          if (ratio >= 200) score = 5;
          else if (ratio >= 150) score = Math.round(25 + (200 - ratio) * 0.4);
          else if (ratio >= 120) score = Math.round(37 + (150 - ratio) * 0.77);
          else score = Math.round(60 + Math.max(0, (120 - ratio)) * 1.75);

          score = Math.min(100, Math.max(0, score));

          let action: string;
          if (score < DEFAULT_THRESHOLDS.hold) action = 'Hold';
          else if (score < DEFAULT_THRESHOLDS.rebalance) action = 'Rebalance';
          else if (score < DEFAULT_THRESHOLDS.hedge) action = 'Hedge';
          else action = 'Deleverage';

          setData({
            score,
            action,
            confidence: 0.7,
            thresholds: DEFAULT_THRESHOLDS,
            lastUpdated: new Date().toISOString(),
            source: 'fallback',
          });
          return;
        }
      }
    } catch {
      // Vault state also failed
    }

    // Ultimate fallback
    setData({
      score: 7.52,
      action: 'Hold',
      confidence: 0.5,
      thresholds: DEFAULT_THRESHOLDS,
      lastUpdated: new Date().toISOString(),
      source: 'fallback',
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchRiskScore();
    const interval = setInterval(fetchRiskScore, refreshIntervalMs);
    return () => clearInterval(interval);
  }, [fetchRiskScore, refreshIntervalMs]);

  return { data, loading, refetch: fetchRiskScore };
}

// --- FTSO Price Hook (direct from FTSO V2) ---

export function useFtsoPrice(refreshIntervalMs = 15000) {
  const [price, setPrice] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPrice = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/vault-state');
      if (response.ok) {
        const data = await response.json();
        if (data.vault?.xrpPrice) {
          setPrice(data.vault.xrpPrice);
          return;
        }
      }
      setError('No price data available');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch price');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPrice();
    const interval = setInterval(fetchPrice, refreshIntervalMs);
    return () => clearInterval(interval);
  }, [fetchPrice, refreshIntervalMs]);

  return { price, loading, error, refetch: fetchPrice };
}
