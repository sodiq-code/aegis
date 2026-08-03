/**
 * Custom React hooks for the Aegis Policy view.
 * 
 * Provides hooks for fetching and updating on-chain policy data
 * from the PolicyRegistry contract on Flare Coston2.
 */

'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

// --- Types ---

export interface OnChainPolicy {
  policyId: number;
  owner: string;
  name: string;
  description: string;
  riskLevel: number;
  riskLevelName: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  maxDrawdownBps: number;
  maxSingleExposureBps: number;
  hedgeThresholdBps: number;
  allowedAssets: string[];
  maxDepositPerTx: number;
  maxWithdrawalPerTx: number;
  maxTotalExposure: number;
  minCollateralRatio: number;
  maxLeverage: number;
  withdrawalDelaySeconds: number;
  rebalanceThresholdBps: number;
  maxSlippageBps: number;
  onRiskBreach: number;
  onRiskBreachName: string;
  onSolvencyWarning: number;
  onSolvencyWarningName: string;
}

export interface PolicyState {
  connected: boolean;
  policyCount: number;
  policies: OnChainPolicy[];
  policyRegistryDeployed: boolean;
  policyRegistryAddress: string;
  lastUpdated: string;
}

export interface ActionCheckResult {
  allowed: boolean;
  action: number;
  actionName: string;
}

export interface PolicyUpdateResult {
  success: boolean;
  policyId?: number;
  transactionHash?: string;
  blockNumber?: number;
  method?: string;
  fieldChanged?: string;
  message?: string;
  error?: string;
}

// --- Policy List Hook ---

export function usePolicyList(refreshIntervalMs = 30000) {
  const [data, setData] = useState<PolicyState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/policy-state', { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      setData(result);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Failed to fetch policies');
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

// --- Single Policy Hook ---

export function useOnChainPolicy(policyId: number | null) {
  const [policy, setPolicy] = useState<OnChainPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPolicy = useCallback(async () => {
    if (!policyId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/policy-state?policyId=${policyId}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      setPolicy(result.policy || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch policy');
      setPolicy(null);
    } finally {
      setLoading(false);
    }
  }, [policyId]);

  useEffect(() => {
    fetchPolicy();
  }, [fetchPolicy]);

  return { policy, loading, error, refetch: fetchPolicy };
}

// --- Action Check Hook ---

export function useActionCheck() {
  const [checking, setChecking] = useState(false);

  const checkAction = useCallback(async (
    policyId: number,
    actionType: 'deposit' | 'withdraw',
    amount: number,
  ): Promise<ActionCheckResult | null> => {
    setChecking(true);
    try {
      const param = actionType === 'deposit' ? 'checkDeposit' : 'checkWithdraw';
      const response = await fetch(`/api/policy-state?policyId=${policyId}&${param}=${amount}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      return actionType === 'deposit' ? result.depositCheck : result.withdrawCheck;
    } catch {
      return null;
    } finally {
      setChecking(false);
    }
  }, []);

  return { checkAction, checking };
}

// --- Policy Update Hook ---

export function usePolicyUpdate() {
  const [updating, setUpdating] = useState(false);
  const [lastResult, setLastResult] = useState<PolicyUpdateResult | null>(null);

  const updatePolicy = useCallback(async (
    policyId: number,
    fieldChanged: string,
  ): Promise<PolicyUpdateResult> => {
    setUpdating(true);
    try {
      const response = await fetch('/api/policy-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policyId, fieldChanged }),
      });
      const result = await response.json();
      setLastResult(result);
      return result;
    } catch (err) {
      const result = {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to update policy',
      };
      setLastResult(result);
      return result;
    } finally {
      setUpdating(false);
    }
  }, []);

  const setPolicyStatus = useCallback(async (
    policyId: number,
    isActive: boolean,
  ): Promise<PolicyUpdateResult> => {
    setUpdating(true);
    try {
      const response = await fetch('/api/policy-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policyId, action: 'set-status', isActive }),
      });
      const result = await response.json();
      setLastResult(result);
      return result;
    } catch (err) {
      const result = {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to set policy status',
      };
      setLastResult(result);
      return result;
    } finally {
      setUpdating(false);
    }
  }, []);

  return { updatePolicy, setPolicyStatus, updating, lastResult };
}
