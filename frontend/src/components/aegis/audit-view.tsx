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
import { useSolvencyData, useProofVerification, useSolvencyProofs } from '@/hooks/use-aegis-data';
import { AEGIS_CONTRACTS } from '@/lib/flare-config';
import {
  FileCheck, CheckCircle2, AlertTriangle, Shield, Eye, EyeOff,
  RefreshCw, Search, Clock, ShieldCheck, Loader2, Info,
  Fingerprint, FileLock2, ScanSearch, Quote
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';

export function AuditView() {
  const { data: solvencyData, loading, error, lastFetched, refetch, requestAttestation } = useSolvencyData();
  const { verifying, verified, verifyError, verificationResult, verifyProof, resetVerification } = useProofVerification();
  const { proofs, loading: proofsLoading, refetch: refetchProofs } = useSolvencyProofs();
  const [showProofData, setShowProofData] = useState(false);
  const [attestationLoading, setAttestationLoading] = useState(false);

  const statusConfig = {
    HEALTHY: { color: 'emerald', icon: ShieldCheck, label: 'Healthy' },
    WARNING: { color: 'yellow', icon: AlertTriangle, label: 'Warning' },
    CRITICAL: { color: 'orange', icon: AlertTriangle, label: 'Critical' },
    INSOLVENT: { color: 'red', icon: AlertTriangle, label: 'Insolvent' },
  } as const;

  const currentStatus = solvencyData?.status ?? 'INSOLVENT';
  const statusInfo = statusConfig[currentStatus as keyof typeof statusConfig] ?? statusConfig.INSOLVENT;

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

          <Separator className="my-4" />

          {/* Key Quote */}
          <div className="flex items-start gap-2 text-sm text-muted-foreground italic">
            <Quote className="h-4 w-4 shrink-0 mt-0.5 text-emerald-500" />
            <p>
              An auditor can verify this treasury is solvent without ever seeing a single position.
              That is the confidentiality-to-verifiability transformation — and it is only possible on Flare.
            </p>
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
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950 flex items-center gap-2 border border-emerald-200 dark:border-emerald-800"
                  >
                    <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                    <div>
                      <p className="font-medium text-emerald-800 dark:text-emerald-200">Proof Verified</p>
                      <p className="text-xs text-emerald-600 dark:text-emerald-400">
                        The solvency proof is cryptographically valid on Coston2
                      </p>
                    </div>
                  </motion.div>
                )}

                {verifyError && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-3 rounded-lg bg-destructive/10 flex items-center gap-2 border border-destructive/20"
                  >
                    <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
                    <div>
                      <p className="font-medium text-destructive">Verification Failed</p>
                      <p className="text-xs text-destructive/80">{verifyError}</p>
                    </div>
                  </motion.div>
                )}

                {/* Detailed Verification Result */}
                <AnimatePresence>
                  {verificationResult && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="space-y-2"
                    >
                      <Separator />
                      <div className="p-3 rounded-lg bg-muted/50 space-y-2">
                        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                          Verification Details
                        </p>
                        <div className="text-xs space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Method</span>
                            <span className="font-medium">{verificationResult.method}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Verified</span>
                            <Badge variant="outline" className={`text-[10px] ${
                              verificationResult.verified
                                ? 'text-emerald-600 border-emerald-300'
                                : 'text-destructive border-destructive/30'
                            }`}>
                              {verificationResult.verified ? 'Yes' : 'No'}
                            </Badge>
                          </div>
                          {verificationResult.proofData && (
                            <>
                              <Separator className="my-1" />
                              <p className="font-medium text-muted-foreground mt-1">Proof Data (on-chain)</p>
                              <div className="space-y-1 pl-2">
                                {verificationResult.proofData.merkleRoot && (
                                  <div className="flex items-start gap-2">
                                    <span className="text-muted-foreground shrink-0">Merkle Root:</span>
                                    <code className="font-mono text-[10px] break-all">{verificationResult.proofData.merkleRoot}</code>
                                  </div>
                                )}
                                <div className="flex items-center justify-between">
                                  <span className="text-muted-foreground">Solvent:</span>
                                  <span className={verificationResult.proofData.solvent ? 'text-emerald-600' : 'text-red-600'}>
                                    {verificationResult.proofData.solvent ? 'Yes' : 'No'}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-muted-foreground">Collateral Ratio:</span>
                                  <span className="tabular-nums">
                                    {verificationResult.proofData.onChainRatio > 0
                                      ? `${(verificationResult.proofData.onChainRatio / 100).toFixed(0)}%`
                                      : 'N/A'}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-muted-foreground">Min Ratio:</span>
                                  <span className="tabular-nums">
                                    {verificationResult.proofData.minRatio > 0
                                      ? `${(verificationResult.proofData.minRatio / 100).toFixed(0)}%`
                                      : '150%'}
                                  </span>
                                </div>
                                {verificationResult.proofData.surplusBps > 0 && (
                                  <div className="flex items-center justify-between">
                                    <span className="text-muted-foreground">Surplus:</span>
                                    <span className="tabular-nums text-emerald-600">
                                      {(verificationResult.proofData.surplusBps / 100).toFixed(2)}%
                                    </span>
                                  </div>
                                )}
                                <div className="flex items-center justify-between">
                                  <span className="text-muted-foreground">Valid:</span>
                                  <span>{verificationResult.proofData.isValid ? 'Yes' : 'No'}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-muted-foreground">Voting Round:</span>
                                  <span className="tabular-nums">{verificationResult.proofData.votingRound.toLocaleString()}</span>
                                </div>
                                {verificationResult.proofData.attestor && verificationResult.proofData.attestor.length > 10 && (
                                  <div className="flex items-center gap-1">
                                    <span className="text-muted-foreground">Attestor:</span>
                                    <BlockExplorerLink type="address" value={verificationResult.proofData.attestor} />
                                  </div>
                                )}
                              </div>
                            </>
                          )}

                          {/* FDC Verification */}
                          {verificationResult.fdcVerification && (
                            <>
                              <Separator className="my-1" />
                              <p className="font-medium text-muted-foreground mt-1">FDC Verification</p>
                              <div className="space-y-1 pl-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-muted-foreground">FDC Verified:</span>
                                  <Badge variant="outline" className={`text-[10px] ${
                                    verificationResult.fdcVerification.verified
                                      ? 'text-emerald-600 border-emerald-300'
                                      : 'text-yellow-600 border-yellow-300'
                                  }`}>
                                    {verificationResult.fdcVerification.verified ? 'Yes' : 'Pending'}
                                  </Badge>
                                </div>
                                {verificationResult.fdcVerification.votingRound > 0 && (
                                  <div className="flex items-center justify-between">
                                    <span className="text-muted-foreground">Voting Round:</span>
                                    <span className="tabular-nums">{verificationResult.fdcVerification.votingRound.toLocaleString()}</span>
                                  </div>
                                )}
                                {verificationResult.fdcVerification.merkleRoot && (
                                  <div className="flex items-start gap-2">
                                    <span className="text-muted-foreground shrink-0">FDC Root:</span>
                                    <code className="font-mono text-[10px] break-all">{verificationResult.fdcVerification.merkleRoot}</code>
                                  </div>
                                )}
                              </div>
                            </>
                          )}

                          {/* Full Explanation */}
                          {verificationResult.details && (
                            <>
                              <Separator className="my-1" />
                              <div className="space-y-1">
                                <p className="font-medium text-muted-foreground">Explanation</p>
                                <p className="text-muted-foreground whitespace-pre-line leading-relaxed">
                                  {verificationResult.details}
                                </p>
                              </div>
                            </>
                          )}

                          <div className="flex items-center justify-between pt-1">
                            <span className="text-muted-foreground">Timestamp:</span>
                            <span className="tabular-nums">{new Date(verificationResult.timestamp).toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

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
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Proof History</CardTitle>
              <CardDescription>Recent solvency attestation publications</CardDescription>
            </div>
            <Button
              onClick={refetchProofs}
              variant="ghost"
              size="sm"
              className="gap-1"
              disabled={proofsLoading}
            >
              <RefreshCw className={`h-3 w-3 ${proofsLoading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {proofsLoading && proofs.length === 0 ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="flex items-center gap-3 py-2">
                  <Skeleton className="h-4 w-4 rounded-full" />
                  <div className="space-y-1 flex-1">
                    <Skeleton className="h-4 w-36" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                  <Skeleton className="h-5 w-12" />
                </div>
              ))}
            </div>
          ) : proofs.length > 0 ? (
            <div className="space-y-0">
              {proofs.map((proof, i) => {
                const ratioPct = proof.collateralRatio > 100
                  ? `${(proof.collateralRatio / 100).toFixed(0)}%`
                  : `${proof.collateralRatio}%`;
                const isHealthy = proof.collateralRatio >= 15000;
                const timeAgo = proof.timestamp > 0
                  ? formatDistanceToNow(new Date(proof.timestamp * 1000), { addSuffix: true })
                  : proof.votingRound > 0
                    ? `VR ${proof.votingRound.toLocaleString()}`
                    : null;
                const hasTxHash = proof.transactionHash && proof.transactionHash.length > 10;

                return (
                  <div key={i} className="flex items-center justify-between py-2.5 border-b last:border-0 hover:bg-muted/30 -mx-2 px-2 rounded transition-colors">
                    <div className="flex items-center gap-3">
                      <FileCheck className={`h-4 w-4 shrink-0 ${isHealthy ? 'text-emerald-500' : 'text-yellow-500'}`} />
                      <div>
                        <p className="text-sm font-medium">Proof published</p>
                        <div className="text-xs text-muted-foreground space-y-0.5">
                          {hasTxHash ? (
                            <p className="flex items-center gap-1 flex-wrap">
                              <span>TX:</span>
                              <BlockExplorerLink type="tx" value={proof.transactionHash} />
                              <span className="mx-0.5">·</span>
                              <span>Block:</span>
                              <BlockExplorerLink
                                type="block"
                                value={proof.blockNumber.toString()}
                                label={proof.blockNumber.toLocaleString()}
                              />
                            </p>
                          ) : (
                            <p className="flex items-center gap-1">
                              <span>Block:</span>
                              <BlockExplorerLink
                                type="block"
                                value={proof.blockNumber.toString()}
                                label={proof.blockNumber.toLocaleString()}
                              />
                            </p>
                          )}
                          {proof.merkleRoot && proof.merkleRoot.length > 10 && (
                            <p className="flex items-center gap-1">
                              <span>Root:</span>
                              <code className="font-mono text-[10px]">{proof.merkleRoot.slice(0, 10)}...{proof.merkleRoot.slice(-4)}</code>
                            </p>
                          )}
                          {proof.attestor && proof.attestor.length > 10 && (
                            <p className="flex items-center gap-1">
                              <span>Attestor:</span>
                              <BlockExplorerLink type="address" value={proof.attestor} />
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge variant="outline" className={`text-xs ${
                        isHealthy ? 'text-emerald-600 border-emerald-300' : 'text-yellow-600 border-yellow-300'
                      }`}>
                        {ratioPct}
                      </Badge>
                      {timeAgo && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {timeAgo}
                        </p>
                      )}
                      {hasTxHash && (
                        <BlockExplorerLink
                          type="tx"
                          value={proof.transactionHash}
                          label="View tx"
                          className="mt-1 inline-flex items-center gap-0.5"
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-6 text-center text-muted-foreground">
              <Info className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No on-chain proof history found</p>
              <p className="text-xs mt-1">Proofs will appear when attestations are published on Coston2</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
