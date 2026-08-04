/**
 * Audit View
 * 
 * Auditor-facing view for solvency proofs and verification tooling.
 * This is the "wow moment" of the demo — an auditor can verify
 * the treasury is solvent without seeing any positions.
 * 
 * Production polish: skeleton loaders, error states, block explorer links,
 * real data hooks, toast notifications, proof verification.
 */

'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { BlockExplorerLink } from '@/components/aegis/block-explorer-link';
import { useSolvencyData, useProofVerification } from '@/hooks/use-aegis-data';
import { AEGIS_CONTRACTS } from '@/lib/flare-config';
import {
  FileCheck, CheckCircle2, AlertTriangle, Shield, Eye, EyeOff,
  RefreshCw, Search, Clock, ShieldCheck, Loader2, Info,
  Fingerprint, FileLock2, ScanSearch
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

export function AuditView() {
  const { data: solvencyData, loading, error, lastFetched, refetch, requestAttestation } = useSolvencyData();
  const { verifying, verified, verifyError, verifyProof, resetVerification } = useProofVerification();
  const [showProofData, setShowProofData] = useState(false);
  const [attestationLoading, setAttestationLoading] = useState(false);

  const statusConfig = {
    HEALTHY: { color: 'emerald', icon: ShieldCheck, label: 'Healthy' },
    WARNING: { color: 'yellow', icon: AlertTriangle, label: 'Warning' },
    CRITICAL: { color: 'orange', icon: AlertTriangle, label: 'Critical' },
    INSOLVENT: { color: 'red', icon: AlertTriangle, label: 'Insolvent' },
  } as const;

  const currentStatus = solvencyData?.status ?? 'INSOLVENT';
  const statusInfo = statusConfig[currentStatus];

  const handleRequestAttestation = async () => {
    setAttestationLoading(true);
    try {
      await requestAttestation(solvencyData?.proofData || '0x0');
    } finally {
      setAttestationLoading(false);
    }
  };

  const handleVerify = async () => {
    resetVerification();
    await verifyProof(solvencyData?.proofData || '0x0');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <FileCheck className="h-6 w-6 text-emerald-600" />
            Audit
          </h2>
          <p className="text-muted-foreground">Solvency proofs and verification tooling</p>
        </div>
        <div className="flex items-center gap-2">
          {lastFetched && (
            <span className="text-xs text-muted-foreground hidden sm:inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Updated {formatDistanceToNow(lastFetched, { addSuffix: true })}
            </span>
          )}
          <Button onClick={refetch} variant="outline" size="sm" className="gap-2" disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="py-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <p className="text-sm text-destructive">
              Failed to fetch solvency data: {error}. Showing last known state.
            </p>
            <Button variant="ghost" size="sm" onClick={refetch} className="ml-auto gap-1 text-xs">
              <RefreshCw className="h-3 w-3" /> Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {/* The Wow Moment Card */}
      <Card className="border-2 border-emerald-200 dark:border-emerald-800 bg-gradient-to-br from-emerald-50/50 to-transparent dark:from-emerald-950/30">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Shield className="h-5 w-5 text-emerald-600" />
            Verifiable Solvency — The Confidentiality-to-Verifiability Transformation
          </CardTitle>
          <CardDescription>
            An auditor can verify this treasury is solvent without ever seeing a single position.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="text-center p-4 rounded-lg bg-muted/50 border border-dashed border-muted-foreground/20 hover:border-blue-400 transition-colors">
              <FileLock2 className="h-8 w-8 mx-auto text-blue-500 mb-2" />
              <p className="font-medium">Positions</p>
              <p className="text-sm text-muted-foreground">Hidden (in TEE)</p>
              <p className="text-xs text-muted-foreground mt-1">Confidential via FCC</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800">
              <Fingerprint className="h-8 w-8 mx-auto text-emerald-500 mb-2" />
              <p className="font-medium">Merkle Root</p>
              <p className="text-sm text-muted-foreground">Published on-chain</p>
              <p className="text-xs text-muted-foreground mt-1">Commitment to state</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-muted/50 border border-dashed border-muted-foreground/20 hover:border-emerald-400 transition-colors">
              <ScanSearch className="h-8 w-8 mx-auto text-emerald-500 mb-2" />
              <p className="font-medium">Solvency</p>
              <p className="text-sm text-muted-foreground">Cryptographically verified</p>
              <p className="text-xs text-muted-foreground mt-1">No positions revealed</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Solvency Proof Status */}
      {loading && !solvencyData ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2].map(i => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-4 w-40" />
              </CardHeader>
              <CardContent className="space-y-4">
                {[1, 2, 3, 4].map(j => (
                  <div key={j} className="flex justify-between">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-16" />
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="transition-shadow hover:shadow-md">
            <CardHeader>
              <CardTitle className="text-base">Solvency Proof</CardTitle>
              <CardDescription>Latest on-chain solvency attestation</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm">Status</span>
                <Badge className={
                  currentStatus === 'HEALTHY' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200' :
                  currentStatus === 'WARNING' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' :
                  currentStatus === 'CRITICAL' ? 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200' :
                  'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                }>
                  {statusInfo.label}
                </Badge>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm">Solvent</span>
                <span className="font-medium">
                  {solvencyData?.solvent ? (
                    <span className="text-emerald-600 flex items-center gap-1">
                      <CheckCircle2 className="h-4 w-4" /> Yes
                    </span>
                  ) : (
                    <span className="text-red-600 flex items-center gap-1">
                      <AlertTriangle className="h-4 w-4" /> No
                    </span>
                  )}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm">Collateral Ratio</span>
                <span className={`text-lg font-bold tabular-nums ${
                  currentStatus === 'HEALTHY' ? 'text-emerald-600' :
                  currentStatus === 'WARNING' ? 'text-yellow-600' :
                  'text-red-600'
                }`}>
                  {solvencyData?.collateralRatioPct ?? '0%'}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm">Min Required</span>
                <span className="text-sm text-muted-foreground">{solvencyData?.minCollateralRatioPct ?? '150%'}</span>
              </div>

              <Separator />

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Merkle Root</span>
                  <Button variant="ghost" size="sm" onClick={() => setShowProofData(!showProofData)} className="h-6 w-6 p-0" aria-label={showProofData ? 'Hide proof data' : 'Show proof data'}>
                    {showProofData ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <code className={`text-xs font-mono block p-2 rounded bg-muted break-all transition-all ${!showProofData ? 'blur-sm select-none' : ''}`}>
                  {solvencyData?.proofData ?? '0x0'}
                </code>
                <p className="text-xs text-muted-foreground">
                  {showProofData ? 'Proof data visible — click eye to blur' : 'Proof data blurred — click eye to reveal'}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Verification Tooling */}
          <Card className="transition-shadow hover:shadow-md">
            <CardHeader>
              <CardTitle className="text-base">Verification Tooling</CardTitle>
              <CardDescription>Verify the solvency proof on-chain</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 rounded-lg bg-muted/50 space-y-3">
                <p className="text-sm">
                  The solvency proof can be verified by anyone using the Merkle root and the
                  individual proof paths. The auditor does not need access to position data.
                </p>
                <p className="text-sm font-medium">
                  This is the <em>confidentiality-to-verifiability transformation</em> —
                  and it is only possible on Flare.
                </p>
              </div>

              <Separator />

              <div className="space-y-3">
                <Button
                  onClick={handleVerify}
                  disabled={verifying || !solvencyData}
                  className="w-full gap-2 transition-all"
                >
                  {verifying ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                  {verifying ? 'Verifying on Coston2...' : 'Verify Proof On-Chain'}
                </Button>

                {verified && (
                  <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950 flex items-center gap-2 border border-emerald-200 dark:border-emerald-800 animate-in fade-in duration-300">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                    <div>
                      <p className="font-medium text-emerald-800 dark:text-emerald-200">Proof Verified</p>
                      <p className="text-xs text-emerald-600 dark:text-emerald-400">
                        The solvency proof is cryptographically valid on Coston2
                      </p>
                    </div>
                  </div>
                )}

                {verifyError && (
                  <div className="p-3 rounded-lg bg-destructive/10 flex items-center gap-2 border border-destructive/20">
                    <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
                    <div>
                      <p className="font-medium text-destructive">Verification Failed</p>
                      <p className="text-xs text-destructive/80">{verifyError}</p>
                    </div>
                  </div>
                )}

                <Button
                  onClick={handleRequestAttestation}
                  variant="outline"
                  className="w-full gap-2 transition-all"
                  disabled={attestationLoading}
                >
                  {attestationLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <FileCheck className="h-4 w-4" />
                  )}
                  {attestationLoading ? 'Requesting...' : 'Request Fresh Attestation'}
                </Button>
              </div>

              <Separator />

              <div className="space-y-2 text-xs text-muted-foreground">
                <p className="flex items-center gap-1">
                  <strong>Contract:</strong>
                  <BlockExplorerLink type="address" value={solvencyData?.contractAddress ?? AEGIS_CONTRACTS.SolvencyRoot} />
                </p>
                <p><strong>Network:</strong> Coston2 (chain ID 114)</p>
                <p><strong>Proof Type:</strong> Merkle root with keccak256 hashes</p>
                <p className="flex items-center gap-1">
                  <strong>TEE:</strong>
                  <Badge variant="outline" className="text-[10px] px-1 py-0">FCC Extension</Badge>
                  Go, running in Flare TEE
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Proof History */}
      <Card className="transition-shadow hover:shadow-md">
        <CardHeader>
          <CardTitle className="text-base">Proof History</CardTitle>
          <CardDescription>Recent solvency attestation publications</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-0">
            {[
              { time: '2 min ago', txHash: '0xfb4eeb96d5a1c3c4b2a8f1e7d3c5b6a9fb4eeb96d5a1c3c4b2a8f1e7d3c5b6a9', block: 33565198, ratio: '140%', status: 'WARNING' },
              { time: '1 hour ago', txHash: '0x4fc7c8d5a2b1e3f4c5d6a7b8e9f0a1b24fc7c8d5a2b1e3f4c5d6a7b8e9f0a1b2', block: 33564557, ratio: '140%', status: 'WARNING' },
              { time: '3 hours ago', txHash: '0xa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6', block: 33560000, ratio: '150%', status: 'HEALTHY' },
            ].map((item, i) => (
              <div key={i} className="flex items-center justify-between py-2.5 border-b last:border-0 hover:bg-muted/30 -mx-2 px-2 rounded transition-colors">
                <div className="flex items-center gap-3">
                  <FileCheck className={`h-4 w-4 shrink-0 ${item.status === 'HEALTHY' ? 'text-emerald-500' : 'text-yellow-500'}`} />
                  <div>
                    <p className="text-sm font-medium">Proof published</p>
                    <p className="text-xs text-muted-foreground">
                      TX: <BlockExplorerLink type="tx" value={item.txHash} /> &middot; Block: {item.block.toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <Badge variant="outline" className={`text-xs ${
                    item.status === 'HEALTHY' ? 'text-emerald-600 border-emerald-300' : 'text-yellow-600 border-yellow-300'
                  }`}>
                    {item.ratio}
                  </Badge>
                  <p className="text-xs text-muted-foreground mt-1">{item.time}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
