/**
 * Custom React hooks for the Aegis Audit view.
 *
 * Provides hooks for:
 *   - Solvency proof data (current proof, status, ratios)
 *   - Proof history (on-chain SolvencyProofPublished events)
 *   - FDC attestation verification
 *   - On-chain proof verification via SolvencyRoot.verifySolvency
 *
 * All data comes from real on-chain contracts on Coston2 via Flare RPC:
 *   - SolvencyRoot: isSolvent(), getCurrentSolvencyProof(), getSolvencyHistory()
 *   - FDCAttestor: getCurrentVotingRound(), getMerkleRoot(), isPaymentVerified()
 *   - FdcVerification: merkleRoot() for voting rounds
 *
 * Task 22 (Day 22): Auditor can request and verify a solvency attestation.
 */

'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

// --- Types ---

export interface SolvencyProof {
  merkleRoot: string;
  surplusBps: number;
  totalFxrpCollateral: number;
  totalLiabilities: number;
  collateralRatio: number;
  timestamp: number;
  votingRound: number;
  attestor: string;
  isValid: boolean;
}

export interface SolvencyStatus {
  connected: boolean;
  solvent: boolean;
  collateralRatio: number;
  minCollateralRatio: number;
  status: 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'INSOLVENT' | 'NO_PROOF';
  currentProof: SolvencyProof | null;
  contractAddress: string;
  lastUpdated: string;
}

export interface ProofHistoryEntry {
  merkleRoot: string;
  surplusBps: number;
  totalFxrpCollateral: number;
  totalLiabilities: number;
  collateralRatio: number;
  timestamp: number;
  votingRound: number;
  attestor: string;
  isValid: boolean;
  blockNumber: number;
  transactionHash: string;
}

export interface FdcAttestationStatus {
  currentVotingRound: number;
  merkleRoot: string;
  attestorVotingRound: number;
  contractsDeployed: Record<string, boolean>;
  fdcHubAddress: string;
  fdcVerificationAddress: string;
  fdcAttestorAddress: string;
  fdc2HubAddress: string;
  fdc2VerificationAddress: string;
  lastUpdated: string;
}

export interface VerificationResult {
  verified: boolean;
  method: string;
  details: string;
  gasUsed?: number;
  blockNumber?: number;
  timestamp: string;
  fdcVerification?: {
    verified: boolean;
    merkleRoot: string;
    votingRound: number;
  };
  proofData?: {
    merkleRoot: string;
    surplusBps: number;
    totalFxrpCollateral: number;
    totalLiabilities: number;
    collateralRatio: number;
    timestamp: number;
    votingRound: number;
    attestor: string;
    isValid: boolean;
    solvent: boolean;
    onChainRatio: number;
    minRatio: number;
  };
}

export interface AttestationRequest {
  requested: boolean;
  votingRound: number;
  feeRequired: string;
  message: string;
  timestamp: string;
}

// --- Solvency Status Hook ---

export function useSolvencyStatus(refreshIntervalMs = 30000) {
  const [data, setData] = useState<SolvencyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/solvency', { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      setData(result);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Failed to fetch solvency status');
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

// --- Proof History Hook ---

export function useProofHistory() {
  const [proofs, setProofs] = useState<ProofHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProofs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/solvency-proofs');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      setProofs(result.proofs || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch proof history');
      setProofs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProofs();
  }, [fetchProofs]);

  return { proofs, loading, error, refetch: fetchProofs };
}

// --- FDC Attestation Status Hook ---

export function useFdcAttestationStatus(refreshIntervalMs = 30000) {
  const [data, setData] = useState<FdcAttestationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/fdc-attestation-status');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch FDC attestation status');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, refreshIntervalMs);
    return () => clearInterval(interval);
  }, [fetchData, refreshIntervalMs]);

  return { data, loading, error, refetch: fetchData };
}

// --- Verification Hook ---

export function useVerifyProof() {
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verify = useCallback(async (merkleRoot: string) => {
    setVerifying(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch('/api/verify-proof', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merkleRoot }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setResult(data);
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Verification failed';
      setError(msg);
      return null;
    } finally {
      setVerifying(false);
    }
  }, []);

  return { result, verifying, error, verify };
}

// --- Request Attestation Hook ---

export function useRequestAttestation() {
  const [result, setResult] = useState<AttestationRequest | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(async () => {
    setRequesting(true);
    setError(null);
    setResult(null);
    try {
      // First try the FCC extension (TEE)
      const response = await fetch('/api/fcc-extension', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: '/api/solvency',
          payload: { action: 'requestAttestation' },
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.status === 'success' || data.merkleRoot) {
          setResult({
            requested: true,
            votingRound: data.votingRound || 0,
            feeRequired: data.feeRequired || '0',
            message: 'Solvency attestation requested via FCC extension (TEE)',
            timestamp: new Date().toISOString(),
          });
          return;
        }
      }

      // Fallback: request via on-chain solvency API
      const fallbackResponse = await fetch('/api/solvency', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'requestAttestation' }),
      });

      if (fallbackResponse.ok) {
        const data = await fallbackResponse.json();
        setResult({
          requested: data.requested ?? true,
          votingRound: data.votingRound || 0,
          feeRequired: data.feeRequired || '0',
          message: data.message || 'Solvency attestation request submitted',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      throw new Error('Both FCC extension and on-chain request failed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Attestation request failed');
    } finally {
      setRequesting(false);
    }
  }, []);

  return { result, requesting, error, request };
}
