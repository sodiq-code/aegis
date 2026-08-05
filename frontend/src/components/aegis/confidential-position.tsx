/**
 * Confidential Position Component (Layer 3)
 *
 * Shows the contrast between on-chain state (minimal: deposits + Merkle root)
 * and the full position computed inside the TEE (what we hold, where, what we owe).
 *
 * On-chain side: reads real data from /api/vault-state and /api/solvency
 * TEE side: reads real Merkle root + collateral + liabilities from the
 *           published solvency proof. Individual position leaves are NOT
 *           revealed — only the aggregate.
 */

'use client';

import { useState, useCallback, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useVaultState } from '@/hooks/use-aegis-data';
import {
  Lock, Eye, EyeOff, Shield, ShieldCheck,
  Loader2, CheckCircle2, AlertTriangle, FileLock2, Quote, ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { AEGIS_CONTRACTS } from '@/lib/flare-config';

interface SolvencyData {
  merkleRoot: string;
  collateralRatio: number;
  surplusBps: number;
  totalFxrpCollateral: number;
  totalLiabilities: number;
  votingRound: number;
  attestor: string;
  isValid: boolean;
  timestamp: number;
}

export function ConfidentialPosition() {
  const { data: vaultState, loading } = useVaultState();
  const [showTeePositions, setShowTeePositions] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [solvency, setSolvency] = useState<SolvencyData | null>(null);

  // Fetch real solvency proof data
  const refreshSolvency = useCallback(async () => {
    try {
      const r = await fetch('/api/solvency');
      if (!r.ok) return;
      const data = await r.json();
      if (data.currentProof) {
        setSolvency({
          merkleRoot: data.currentProof.merkleRoot,
          collateralRatio: data.currentProof.collateralRatio,
          surplusBps: data.currentProof.surplusBps,
          totalFxrpCollateral: data.currentProof.totalFxrpCollateral,
          totalLiabilities: data.currentProof.totalLiabilities,
          votingRound: data.currentProof.votingRound,
          attestor: data.currentProof.attestor,
          isValid: data.currentProof.isValid,
          timestamp: data.currentProof.timestamp,
        });
      }
    } catch {}
  }, []);

  useEffect(() => {
    refreshSolvency();
    const interval = setInterval(refreshSolvency, 15000);
    return () => clearInterval(interval);
  }, [refreshSolvency]);

  const vault = vaultState?.vault;
  const totalDeposited = vault ? (vault.totalDeposited / 1e6).toFixed(2) : '0.00';
  const positionCount = vault?.positionCount ?? 0;
  const merkleRoot = solvency?.merkleRoot || '0x0000...';

  // TEE-computed aggregates (from the published solvency proof, NOT hardcoded)
  // These are real on-chain values published by the verifier key.
  // Individual position leaves remain confidential — only the aggregate is shown.
  const teeAssets = solvency ? [
    {
      asset: 'FXRP Collateral',
      amount: (solvency.totalFxrpCollateral / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 }),
      venue: 'VaultCore',
      chain: 'Flare Coston2',
    },
  ] : [];
  const teeLiabilities = solvency ? [
    {
      source: 'FXRP Deposits',
      amount: (solvency.totalLiabilities / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 }),
    },
  ] : [];

  // TEE attestation = the on-chain publish tx (real, verifiable)
  const teeAttestationHash = solvency?.merkleRoot || '';

  const handleVerifyTee = useCallback(async () => {
    setVerifying(true);
    setVerifyError(null);
    setVerified(false);
    try {
      // Real verification: check the on-chain proof is valid + matches what we display
      const r = await fetch('/api/verify-proof', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merkleRoot: solvency?.merkleRoot }),
      });
      const data = await r.json();
      if (data.verified) {
        setVerified(true);
      } else {
        setVerifyError(data.error || 'On-chain proof is not valid');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'TEE verification failed';
      setVerifyError(msg);
    } finally {
      setVerifying(false);
    }
  }, [solvency]);

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <FileLock2 className="h-5 w-5 text-emerald-600" />
          Confidential Position
          <Badge variant="outline" className="text-[10px] px-1 py-0">Layer 3</Badge>
        </CardTitle>
        <CardDescription>
          On-chain state reveals only deposits + Merkle root — positions are confidential
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          {/* On-Chain State */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-muted-foreground" />
              <h4 className="text-sm font-semibold">On-Chain State</h4>
              <Badge variant="secondary" className="text-[10px]">Public</Badge>
            </div>
            <div className="p-3 rounded-lg bg-muted/50 space-y-2">
              {loading && !vaultState ? (
                <>
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-full" />
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Total Deposited</span>
                    <span className="text-sm font-medium tabular-nums">{totalDeposited} FXRP</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Position Count</span>
                    <span className="text-sm font-medium tabular-nums">{positionCount}</span>
                  </div>
                  <Separator />
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">Merkle Root (current)</span>
                    <code className="text-[10px] font-mono block break-all blur-sm select-none text-muted-foreground">
                      {merkleRoot}
                    </code>
                    <p className="text-[10px] text-muted-foreground italic">Blurred — commitment to full state</p>
                    {solvency && (
                      <p className="text-[10px] text-muted-foreground">
                        Voting round: {solvency.votingRound} · Valid: {solvency.isValid ? 'Yes' : 'No'}
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              The on-chain state shows <strong>only</strong> aggregate data and a Merkle root.
              Individual positions are never revealed on-chain.
            </p>
          </div>

          {/* TEE Computed */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-emerald-500" />
              <h4 className="text-sm font-semibold">TEE Computed</h4>
              <Badge variant="outline" className="text-[10px] px-1 py-0 border-emerald-300 text-emerald-600">Confidential</Badge>
            </div>
            <div className="p-3 rounded-lg bg-emerald-50/50 dark:bg-emerald-950/30 space-y-2 border border-emerald-100 dark:border-emerald-900">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium">Aggregate Position (from on-chain proof)</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowTeePositions(!showTeePositions)}
                  className="h-6 w-6 p-0"
                  aria-label={showTeePositions ? 'Hide positions' : 'Show positions'}
                >
                  {showTeePositions ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </Button>
              </div>

              {solvency ? (
                <div className={`transition-all duration-300 ${!showTeePositions ? 'blur-sm select-none' : ''}`}>
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">What We Hold</p>
                  {teeAssets.map((pos, i) => (
                    <div key={i} className="flex items-center justify-between py-0.5">
                      <span className="text-xs">{pos.asset}</span>
                      <span className="text-xs tabular-nums font-medium">{pos.amount}</span>
                    </div>
                  ))}
                  <Separator className="my-2" />
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">What We Owe</p>
                  {teeLiabilities.map((liab, i) => (
                    <div key={i} className="flex items-center justify-between py-0.5">
                      <span className="text-xs">{liab.source}</span>
                      <span className="text-xs tabular-nums font-medium">{liab.amount}</span>
                    </div>
                  ))}
                  <Separator className="my-2" />
                  <div className="flex items-center justify-between py-0.5">
                    <span className="text-[10px] text-muted-foreground">Collateral Ratio</span>
                    <span className="text-xs tabular-nums font-medium">{(solvency.collateralRatio / 100).toFixed(0)}%</span>
                  </div>
                  <div className="flex items-center justify-between py-0.5">
                    <span className="text-[10px] text-muted-foreground">Surplus</span>
                    <span className="text-xs tabular-nums font-medium">{(solvency.surplusBps / 100).toFixed(0)}%</span>
                  </div>
                </div>
              ) : (
                <Skeleton className="h-12 w-full" />
              )}

              {!showTeePositions && solvency && (
                <p className="text-[10px] text-muted-foreground italic text-center">
                  Click eye to reveal — individual position leaves are confidential
                </p>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Aggregate collateral + liabilities from the published solvency proof.
              Individual position leaves remain inside the TEE.
            </p>
          </div>
        </div>

        <Separator />

        {/* TEE Attestation */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            <h4 className="text-sm font-semibold">TEE Attestation</h4>
          </div>

          <div className="p-3 rounded-lg bg-muted/50 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">On-chain Merkle Root</span>
              <code className="text-[10px] font-mono text-muted-foreground">
                {teeAttestationHash ? `${teeAttestationHash.slice(0, 20)}...` : '—'}
              </code>
            </div>
            {solvency && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Attestor (verifier)</span>
                  <a
                    href={`https://coston2-explorer.flare.network/address/${solvency.attestor}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] font-mono text-emerald-600 hover:underline inline-flex items-center gap-0.5"
                  >
                    {solvency.attestor.slice(0, 8)}...{solvency.attestor.slice(-4)}
                    <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">SolvencyRoot contract</span>
                  <a
                    href={`https://coston2-explorer.flare.network/address/${AEGIS_CONTRACTS.SolvencyRoot}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] font-mono text-emerald-600 hover:underline inline-flex items-center gap-0.5"
                  >
                    {AEGIS_CONTRACTS.SolvencyRoot.slice(0, 8)}...{AEGIS_CONTRACTS.SolvencyRoot.slice(-4)}
                    <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                </div>
              </>
            )}
            <p className="text-xs text-muted-foreground italic">
              The Merkle root is published on-chain by the TEE verifier key. Anyone can verify
              the proof against the on-chain root — without seeing any individual position.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={handleVerifyTee}
              disabled={verifying || !solvency}
              variant="outline"
              size="sm"
              className="gap-2 transition-all"
            >
              {verifying ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ShieldCheck className="h-3.5 w-3.5" />
              )}
              {verifying ? 'Verifying on-chain...' : 'Verify TEE Attestation'}
            </Button>

            <AnimatePresence>
              {verified && (
                <motion.div
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex items-center gap-1 text-emerald-600"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span className="text-xs font-medium">On-chain proof verified</span>
                </motion.div>
              )}
              {verifyError && (
                <motion.div
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex items-center gap-1 text-destructive"
                >
                  <AlertTriangle className="h-4 w-4" />
                  <span className="text-xs">{verifyError}</span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <Separator />

        {/* Quote */}
        <div className="flex items-start gap-2 text-xs text-muted-foreground italic">
          <Quote className="h-3 w-3 shrink-0 mt-0.5 text-emerald-500" />
          <p>The full position — what we hold, where, and what we owe — is computed inside this TEE.
            Anyone can verify the proof against the on-chain root; no one can see the positions inside it.</p>
        </div>
      </CardContent>
    </Card>
  );
}
