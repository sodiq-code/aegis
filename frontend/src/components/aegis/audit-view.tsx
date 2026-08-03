/**
 * Audit View — Task 22 (Day 22)
 *
 * Auditor-facing view for solvency proofs and verification tooling.
 * This is the "wow moment" of the demo — an auditor can verify
 * the treasury is solvent without seeing any positions.
 *
 * All data comes from real on-chain contracts on Coston2 via Flare RPC:
 *   - SolvencyRoot: isSolvent(), getCurrentSolvencyProof(), getSolvencyHistory()
 *   - FDCAttestor: getCurrentVotingRound(), getMerkleRoot()
 *   - FdcVerification: merkleRoot() for voting rounds
 *
 * Acceptance criterion: Auditor can request and verify a solvency attestation.
 */

'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import {
  FileCheck, CheckCircle2, AlertTriangle, Shield, Eye, EyeOff,
  RefreshCw, Search, ExternalLink, Clock, Loader2, Wifi, WifiOff,
  Fingerprint, KeyRound, Network, Database, ChevronDown, ChevronUp,
} from 'lucide-react';
import {
  useSolvencyStatus, useProofHistory, useFdcAttestationStatus,
  useVerifyProof, useRequestAttestation,
} from '@/hooks/use-audit-data';
import { AEGIS_CONTRACTS, FLARE_SYSTEM_CONTRACTS } from '@/lib/flare-config';

// --- Block Explorer Link ---
const BLOCK_EXPLORER = 'https://coston2-explorer.flare.network';

function BlockExplorerLink({ txHash, label }: { txHash: string; label?: string }) {
  if (txHash === 'current') return <span className="text-xs">current</span>;
  return (
    <a
      href={`${BLOCK_EXPLORER}/tx/${txHash}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200"
    >
      {label || `${txHash.slice(0, 10)}...${txHash.slice(-4)}`}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

function formatTimeAgo(timestamp: number): string {
  if (!timestamp) return '—';
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function ratioToStatus(ratio: number, minRatio: number): 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'INSOLVENT' | 'NO_PROOF' {
  if (ratio === 0) return 'NO_PROOF';
  if (ratio >= minRatio) return 'HEALTHY';
  if (ratio >= minRatio * 0.8) return 'WARNING';
  if (ratio >= minRatio * 0.6) return 'CRITICAL';
  return 'INSOLVENT';
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string }> = {
    HEALTHY: { bg: 'bg-emerald-100 dark:bg-emerald-900', text: 'text-emerald-800 dark:text-emerald-200' },
    WARNING: { bg: 'bg-yellow-100 dark:bg-yellow-900', text: 'text-yellow-800 dark:text-yellow-200' },
    CRITICAL: { bg: 'bg-orange-100 dark:bg-orange-900', text: 'text-orange-800 dark:text-orange-200' },
    INSOLVENT: { bg: 'bg-red-100 dark:bg-red-900', text: 'text-red-800 dark:text-red-200' },
    NO_PROOF: { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-800 dark:text-gray-200' },
  };
  const c = config[status] || config.NO_PROOF;
  return <Badge className={`${c.bg} ${c.text}`}>{status}</Badge>;
}

// --- Main Audit View ---
export function AuditView() {
  // Data hooks
  const { data: solvencyStatus, loading: solvencyLoading, error: solvencyError, refetch: refetchSolvency } = useSolvencyStatus();
  const { proofs, loading: proofsLoading, error: proofsError, refetch: refetchProofs } = useProofHistory();
  const { data: fdcStatus, loading: fdcLoading, error: fdcError, refetch: refetchFdc } = useFdcAttestationStatus();
  const { result: verifyResult, verifying, error: verifyError, verify } = useVerifyProof();
  const { result: attestResult, requesting, error: attestError, request: requestAttestation } = useRequestAttestation();

  // UI state
  const [showProofData, setShowProofData] = useState(false);
  const [showVerifyDetails, setShowVerifyDetails] = useState(false);
  const [expandedProof, setExpandedProof] = useState<number | null>(null);

  const isRefreshing = solvencyLoading || proofsLoading || fdcLoading;

  const handleRefresh = () => {
    refetchSolvency();
    refetchProofs();
    refetchFdc();
  };

  const handleVerify = () => {
    const merkleRoot = solvencyStatus?.currentProof?.merkleRoot || solvencyStatus?.contractAddress || '';
    if (merkleRoot) verify(merkleRoot);
  };

  const handleRequestAttestation = () => {
    requestAttestation();
  };

  // Computed values from real on-chain data
  const connected = solvencyStatus?.connected ?? false;
  const solvent = solvencyStatus?.solvent ?? false;
  const collateralRatio = solvencyStatus?.collateralRatio ?? 0;
  const minCollateralRatio = solvencyStatus?.minCollateralRatio ?? 15000;
  const status = solvencyStatus?.status ?? 'NO_PROOF';
  const currentProof = solvencyStatus?.currentProof;
  const proofMerkleRoot = currentProof?.merkleRoot || solvencyStatus?.contractAddress || '';
  const collateralRatioPct = collateralRatio > 0 ? `${(collateralRatio / 100).toFixed(0)}%` : '—';
  const minRatioPct = minCollateralRatio > 0 ? `${(minCollateralRatio / 100).toFixed(0)}%` : '150%';

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
        <Button onClick={handleRefresh} variant="outline" size="sm" className="gap-2" disabled={isRefreshing}>
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Connection Status */}
      <div className="flex items-center gap-3 flex-wrap">
        {connected ? (
          <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
            <Wifi className="mr-1 h-3 w-3" /> Connected to Coston2
          </Badge>
        ) : (
          <Badge variant="destructive">
            <WifiOff className="mr-1 h-3 w-3" /> Disconnected
          </Badge>
        )}
        {fdcStatus?.currentVotingRound ? (
          <Badge variant="outline" className="text-xs">
            <Network className="mr-1 h-3 w-3" /> Voting Round {fdcStatus.currentVotingRound}
          </Badge>
        ) : null}
        {solvencyError && (
          <Badge variant="destructive" className="text-xs">RPC Error: {solvencyError}</Badge>
        )}
      </div>

      {/* The Wow Moment Card — Confidentiality-to-Verifiability Transformation */}
      <Card className="border-2 border-emerald-200 dark:border-emerald-800">
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
            <div className="text-center p-4 rounded-lg bg-muted/50">
              <EyeOff className="h-8 w-8 mx-auto text-blue-500 mb-2" />
              <p className="font-medium">Positions</p>
              <p className="text-sm text-muted-foreground">Hidden (in TEE)</p>
              <p className="text-xs text-muted-foreground mt-1">FCC extension computes state privately</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950">
              <Shield className="h-8 w-8 mx-auto text-emerald-500 mb-2" />
              <p className="font-medium">Merkle Root</p>
              <p className="text-sm text-muted-foreground">Published on-chain</p>
              <p className="text-xs text-muted-foreground mt-1">
                {solvencyLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin mx-auto" />
                ) : currentProof?.merkleRoot ? (
                  <span className="font-mono">{currentProof.merkleRoot.slice(0, 10)}...</span>
                ) : (
                  'No proof published'
                )}
              </p>
            </div>
            <div className="text-center p-4 rounded-lg bg-muted/50">
              <CheckCircle2 className={`h-8 w-8 mx-auto mb-2 ${solvent ? 'text-emerald-500' : 'text-red-500'}`} />
              <p className="font-medium">Solvency</p>
              <p className="text-sm text-muted-foreground">
                {solvent ? 'Cryptographically verified' : 'Not verified'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">{collateralRatioPct} collateral ratio</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Solvency Proof + Verification Tooling */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Solvency Proof Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Solvency Proof</CardTitle>
            <CardDescription>Latest on-chain solvency attestation from SolvencyRoot</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {solvencyLoading ? (
              <div className="flex items-center gap-2 py-4">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-muted-foreground text-sm">Loading on-chain proof...</span>
              </div>
            ) : (
              <>
                {/* Status */}
                <div className="flex items-center justify-between">
                  <span className="text-sm">Status</span>
                  <StatusBadge status={status} />
                </div>

                {/* Solvent */}
                <div className="flex items-center justify-between">
                  <span className="text-sm">Solvent</span>
                  {solvent ? (
                    <span className="text-emerald-600 flex items-center gap-1 font-medium">
                      <CheckCircle2 className="h-4 w-4" /> Yes
                    </span>
                  ) : (
                    <span className="text-red-600 flex items-center gap-1 font-medium">
                      <AlertTriangle className="h-4 w-4" /> No
                    </span>
                  )}
                </div>

                {/* Collateral Ratio */}
                <div className="flex items-center justify-between">
                  <span className="text-sm">Collateral Ratio</span>
                  <span className={`text-lg font-bold ${
                    collateralRatio >= minCollateralRatio ? 'text-emerald-600' :
                    collateralRatio >= minCollateralRatio * 0.8 ? 'text-yellow-600' : 'text-red-600'
                  }`}>{collateralRatioPct}</span>
                </div>

                {/* Collateral Ratio Progress */}
                <Progress value={Math.min(collateralRatio / 100, 200)} max={200} className="h-2" />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>0%</span>
                  <span className={collateralRatio >= minCollateralRatio ? 'text-emerald-600' : 'text-yellow-600'}>
                    Min: {minRatioPct}
                  </span>
                  <span>200%</span>
                </div>

                {/* Min Required */}
                <div className="flex items-center justify-between">
                  <span className="text-sm">Min Required</span>
                  <span className="text-sm text-muted-foreground">{minRatioPct}</span>
                </div>

                <Separator />

                {/* Merkle Root (blurrable) */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Merkle Root</span>
                    <Button variant="ghost" size="sm" onClick={() => setShowProofData(!showProofData)}>
                      {showProofData ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                  <code className={`text-xs font-mono block p-2 rounded bg-muted break-all ${!showProofData ? 'blur-sm select-none' : ''}`}>
                    {currentProof?.merkleRoot || '0x0'}
                  </code>
                  <p className="text-xs text-muted-foreground">
                    {showProofData ? 'Proof data visible (auditor mode)' : 'Proof data blurred — click eye to reveal'}
                  </p>
                </div>

                {/* Proof metadata */}
                {currentProof && currentProof.timestamp > 0 && (
                  <>
                    <Separator />
                    <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                      <div>
                        <p className="font-medium text-foreground">Surplus</p>
                        <p>{currentProof.surplusBps ? `${(currentProof.surplusBps / 100).toFixed(2)}%` : '—'}</p>
                      </div>
                      <div>
                        <p className="font-medium text-foreground">Voting Round</p>
                        <p>{currentProof.votingRound || '—'}</p>
                      </div>
                      <div>
                        <p className="font-medium text-foreground">Attestor</p>
                        <p className="font-mono">{currentProof.attestor ? `${currentProof.attestor.slice(0, 8)}...` : '—'}</p>
                      </div>
                      <div>
                        <p className="font-medium text-foreground">Valid</p>
                        <p>{currentProof.isValid ? 'Yes' : 'No (superseded)'}</p>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Verification Tooling Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Verification Tooling</CardTitle>
            <CardDescription>Verify the solvency proof on-chain (SolvencyRoot + FDC)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Explanation */}
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

            {/* Verify Proof Button */}
            <div className="space-y-3">
              <Button
                onClick={handleVerify}
                disabled={verifying || !proofMerkleRoot}
                className="w-full gap-2"
              >
                {verifying ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                {verifying ? 'Verifying on Coston2...' : 'Verify Proof On-Chain'}
              </Button>

              {/* Verification Error */}
              {verifyError && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950 flex items-start gap-2">
                  <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-red-800 dark:text-red-200">Verification Failed</p>
                    <p className="text-xs text-red-600 dark:text-red-400">{verifyError}</p>
                  </div>
                </div>
              )}

              {/* Verification Success */}
              {verifyResult && (
                <div className="space-y-2">
                  <div className={`p-3 rounded-lg flex items-start gap-2 ${
                    verifyResult.verified
                      ? 'bg-emerald-50 dark:bg-emerald-950'
                      : 'bg-yellow-50 dark:bg-yellow-950'
                  }`}>
                    {verifyResult.verified ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0">
                      <p className={`font-medium ${
                        verifyResult.verified
                          ? 'text-emerald-800 dark:text-emerald-200'
                          : 'text-yellow-800 dark:text-yellow-200'
                      }`}>
                        {verifyResult.verified ? 'Proof Verified On-Chain' : 'Proof Not Verified'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Method: {verifyResult.method}
                      </p>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs mt-1 h-auto p-0"
                        onClick={() => setShowVerifyDetails(!showVerifyDetails)}
                      >
                        {showVerifyDetails ? <ChevronUp className="h-3 w-3 mr-1" /> : <ChevronDown className="h-3 w-3 mr-1" />}
                        {showVerifyDetails ? 'Hide details' : 'Show details'}
                      </Button>
                      {showVerifyDetails && (
                        <pre className="text-xs mt-2 p-2 rounded bg-muted overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto">
                          {verifyResult.details}
                        </pre>
                      )}
                    </div>
                  </div>

                  {/* FDC verification info */}
                  {verifyResult.fdcVerification && (
                    <div className="p-2 rounded bg-muted/50 text-xs text-muted-foreground">
                      <p className="font-medium text-foreground">FDC Verification</p>
                      <p>Merkle Root: {verifyResult.fdcVerification.merkleRoot
                        ? `${verifyResult.fdcVerification.merkleRoot.slice(0, 18)}...`
                        : 'Not available'
                      }</p>
                      <p>Voting Round: {verifyResult.fdcVerification.votingRound || '—'}</p>
                    </div>
                  )}
                </div>
              )}

              <Separator />

              {/* Request Fresh Attestation Button */}
              <Button
                onClick={handleRequestAttestation}
                variant="outline"
                disabled={requesting}
                className="w-full gap-2"
              >
                {requesting ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <FileCheck className="h-4 w-4" />
                )}
                {requesting ? 'Requesting...' : 'Request Fresh Attestation'}
              </Button>

              {/* Attestation Result */}
              {attestError && (
                <p className="text-xs text-destructive">{attestError}</p>
              )}
              {attestResult && attestResult.requested && (
                <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950 text-xs">
                  <p className="font-medium text-blue-800 dark:text-blue-200">Attestation Requested</p>
                  <p className="text-blue-600 dark:text-blue-400">{attestResult.message}</p>
                  {attestResult.votingRound > 0 && (
                    <p className="mt-1">Voting Round: {attestResult.votingRound}</p>
                  )}
                </div>
              )}
            </div>

            <Separator />

            {/* Infrastructure details */}
            <div className="space-y-2 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Infrastructure</p>
              <div className="grid grid-cols-1 gap-1">
                <p>
                  <strong>SolvencyRoot:</strong>{' '}
                  <a
                    href={`${BLOCK_EXPLORER}/address/${AEGIS_CONTRACTS.SolvencyRoot}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline dark:text-blue-400"
                  >
                    {AEGIS_CONTRACTS.SolvencyRoot.slice(0, 8)}...
                    <ExternalLink className="inline h-3 w-3 ml-0.5" />
                  </a>
                </p>
                <p>
                  <strong>FDCAttestor:</strong>{' '}
                  <a
                    href={`${BLOCK_EXPLORER}/address/${AEGIS_CONTRACTS.FDCAttestor}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline dark:text-blue-400"
                  >
                    {AEGIS_CONTRACTS.FDCAttestor.slice(0, 8)}...
                    <ExternalLink className="inline h-3 w-3 ml-0.5" />
                  </a>
                </p>
                <p>
                  <strong>FdcVerification:</strong>{' '}
                  <a
                    href={`${BLOCK_EXPLORER}/address/${FLARE_SYSTEM_CONTRACTS.FdcVerification}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline dark:text-blue-400"
                  >
                    {FLARE_SYSTEM_CONTRACTS.FdcVerification.slice(0, 8)}...
                    <ExternalLink className="inline h-3 w-3 ml-0.5" />
                  </a>
                </p>
                <p><strong>Network:</strong> Coston2 (chain ID 114)</p>
                <p><strong>Proof Type:</strong> Merkle root with keccak256 hashes</p>
                <p><strong>TEE:</strong> FCC extension (Go, running in Flare TEE)</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* FDC Attestation Infrastructure */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">FDC Attestation Infrastructure</CardTitle>
          <CardDescription>
            Flare Data Connector status — attestation layer for cross-chain state verification
          </CardDescription>
        </CardHeader>
        <CardContent>
          {fdcLoading ? (
            <div className="flex items-center gap-2 py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-muted-foreground text-sm">Loading FDC status...</span>
            </div>
          ) : fdcStatus ? (
            <div className="grid gap-4 md:grid-cols-3">
              {/* Current Voting Round */}
              <div className="p-3 rounded-lg bg-muted/50">
                <div className="flex items-center gap-2 mb-2">
                  <Network className="h-4 w-4 text-blue-500" />
                  <p className="text-sm font-medium">Voting Round</p>
                </div>
                <p className="text-2xl font-bold">{fdcStatus.currentVotingRound || '—'}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {fdcStatus.attestorVotingRound ? `Attestor: round ${fdcStatus.attestorVotingRound}` : 'Attestor: not synced'}
                </p>
              </div>

              {/* FDC Merkle Root */}
              <div className="p-3 rounded-lg bg-muted/50">
                <div className="flex items-center gap-2 mb-2">
                  <Fingerprint className="h-4 w-4 text-violet-500" />
                  <p className="text-sm font-medium">FDC Merkle Root</p>
                </div>
                {fdcStatus.merkleRoot ? (
                  <code className="text-xs font-mono block break-all">{fdcStatus.merkleRoot.slice(0, 18)}...</code>
                ) : (
                  <p className="text-sm text-muted-foreground">No root for current round</p>
                )}
              </div>

              {/* FDC Contracts Deployed */}
              <div className="p-3 rounded-lg bg-muted/50">
                <div className="flex items-center gap-2 mb-2">
                  <Database className="h-4 w-4 text-emerald-500" />
                  <p className="text-sm font-medium">Contracts Deployed</p>
                </div>
                <div className="space-y-1 text-xs">
                  {Object.entries(fdcStatus.contractsDeployed || {}).map(([name, deployed]) => (
                    <div key={name} className="flex items-center gap-1">
                      {deployed ? (
                        <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                      ) : (
                        <AlertTriangle className="h-3 w-3 text-red-500" />
                      )}
                      <span>{name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-4 text-muted-foreground">
              <p className="text-sm">FDC status unavailable</p>
              {fdcError && <p className="text-xs text-destructive mt-1">{fdcError}</p>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Proof History */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Proof History</CardTitle>
              <CardDescription>Recent solvency attestation publications from on-chain events</CardDescription>
            </div>
            {proofsLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
        </CardHeader>
        <CardContent>
          {proofsError && (
            <div className="text-xs text-destructive mb-3">Error: {proofsError}</div>
          )}
          {proofs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileCheck className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No solvency proofs found</p>
              <p className="text-xs mt-1">Proofs will appear here when the FCC extension publishes solvency attestations</p>
            </div>
          ) : (
            <div className="space-y-1">
              {proofs.map((proof, i) => {
                const proofStatus = ratioToStatus(proof.collateralRatio, minCollateralRatio);
                const ratioPct = proof.collateralRatio > 0 ? `${(proof.collateralRatio / 100).toFixed(0)}%` : '—';
                const isExpanded = expandedProof === i;

                return (
                  <div key={`${proof.merkleRoot}-${i}`}
                    className="border-b last:border-0"
                  >
                    <div
                      className="flex items-start justify-between py-3 gap-3 cursor-pointer hover:bg-muted/30 px-1 rounded"
                      onClick={() => setExpandedProof(isExpanded ? null : i)}
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="flex-shrink-0 mt-0.5">
                          {proof.isValid ? (
                            <FileCheck className="h-4 w-4 text-emerald-500" />
                          ) : (
                            <FileCheck className="h-4 w-4 text-muted-400" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium">
                              {proof.isValid ? 'Current Proof' : 'Proof Published'}
                            </p>
                            <StatusBadge status={proofStatus} />
                            {proof.isValid && (
                              <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200 text-xs">LATEST</Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            <span>Collateral: {ratioPct}</span>
                            <span className="mx-2">|</span>
                            <span>Surplus: {proof.surplusBps ? `${(proof.surplusBps / 100).toFixed(1)}%` : '—'}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <BlockExplorerLink txHash={proof.transactionHash} />
                            <span className="text-xs text-muted-foreground">Block {proof.blockNumber.toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0 flex items-center gap-2">
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatTimeAgo(proof.timestamp)}
                        </span>
                        {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                      </div>
                    </div>

                    {/* Expanded proof details */}
                    {isExpanded && (
                      <div className="px-4 pb-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs text-muted-foreground">
                        <div>
                          <p className="font-medium text-foreground">Merkle Root</p>
                          <code className="font-mono break-all">{proof.merkleRoot.slice(0, 20)}...</code>
                        </div>
                        <div>
                          <p className="font-medium text-foreground">Total Collateral</p>
                          <p>{proof.totalFxrpCollateral ? (proof.totalFxrpCollateral / 1e6).toFixed(2) : '—'} FXRP</p>
                        </div>
                        <div>
                          <p className="font-medium text-foreground">Total Liabilities</p>
                          <p>{proof.totalLiabilities ? (proof.totalLiabilities / 1e6).toFixed(2) : '—'} FXRP</p>
                        </div>
                        <div>
                          <p className="font-medium text-foreground">Attestor</p>
                          <p className="font-mono">{proof.attestor ? `${proof.attestor.slice(0, 10)}...` : '—'}</p>
                        </div>
                        <div>
                          <p className="font-medium text-foreground">Collateral Ratio</p>
                          <p>{ratioPct}</p>
                        </div>
                        <div>
                          <p className="font-medium text-foreground">Surplus BPS</p>
                          <p>{proof.surplusBps}</p>
                        </div>
                        <div>
                          <p className="font-medium text-foreground">Voting Round</p>
                          <p>{proof.votingRound || '—'}</p>
                        </div>
                        <div>
                          <p className="font-medium text-foreground">Valid</p>
                          <p>{proof.isValid ? 'Yes' : 'No (superseded)'}</p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Verification How-To Guide */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">How Verification Works</CardTitle>
          <CardDescription>
            Step-by-step explanation of the auditor verification flow
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-5">
            {[
              { step: 1, icon: <KeyRound className="h-5 w-5" />, title: 'TEE Computes', desc: 'FCC extension computes position state inside a Trusted Execution Environment on Flare.' },
              { step: 2, icon: <Shield className="h-5 w-5" />, title: 'Root Published', desc: 'SolvencyAttestor publishes the Merkle root of all positions to SolvencyRoot on-chain.' },
              { step: 3, icon: <Fingerprint className="h-5 w-5" />, title: 'FDC Anchors', desc: 'Flare Data Connector attests external state (XRPL payments, prices) via voting rounds.' },
              { step: 4, icon: <Search className="h-5 w-5" />, title: 'Auditor Verifies', desc: 'Anyone calls verifySolvency(proof, leaf) on SolvencyRoot to check a position against the root.' },
              { step: 5, icon: <CheckCircle2 className="h-5 w-5" />, title: 'Trustless Proof', desc: 'The proof is valid if the Merkle path resolves to the published root — no trust in operator needed.' },
            ].map(({ step, icon, title, desc }) => (
              <div key={step} className="text-center p-3 rounded-lg bg-muted/30">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <span className="text-xs font-bold text-emerald-600 bg-emerald-100 dark:bg-emerald-900 rounded-full w-5 h-5 flex items-center justify-center">{step}</span>
                  <div className="text-emerald-600">{icon}</div>
                </div>
                <p className="text-sm font-medium">{title}</p>
                <p className="text-xs text-muted-foreground mt-1">{desc}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
