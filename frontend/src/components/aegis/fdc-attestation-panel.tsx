/**
 * FDC Attestation Panel Component
 *
 * Shows FDC (Flare Data Connector) attestation infrastructure status:
 * - Current voting round
 * - FDC Merkle root
 * - Contract deployment status (FdcHub, FdcVerification, FDCAttestor, Fdc2Hub, Fdc2Verification)
 *
 * Fetches from /api/fdc-attestation-status
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
// Badge available for future status indicators
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { BlockExplorerLink } from '@/components/aegis/block-explorer-link';
import { AEGIS_CONTRACTS, FLARE_SYSTEM_CONTRACTS } from '@/lib/flare-config';
import {
  ShieldCheck, CheckCircle2, AlertTriangle, RefreshCw,
  Activity, Hash, Clock
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface FdcStatus {
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
  error?: string;
}

const CONTRACT_LABELS: Record<string, { name: string; address: string }> = {
  FdcHub: { name: 'FdcHub', address: FLARE_SYSTEM_CONTRACTS.FdcHub },
  FdcVerification: { name: 'FdcVerification', address: FLARE_SYSTEM_CONTRACTS.FdcVerification },
  FDCAttestor: { name: 'FDCAttestor', address: AEGIS_CONTRACTS.FDCAttestor },
  Fdc2Hub: { name: 'Fdc2Hub', address: FLARE_SYSTEM_CONTRACTS.Fdc2Hub },
  Fdc2Verification: { name: 'Fdc2Verification', address: FLARE_SYSTEM_CONTRACTS.Fdc2Verification },
};

export function FdcAttestationPanel() {
  const [data, setData] = useState<FdcStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/fdc-attestation-status');
      if (!response.ok) throw new Error(`API returned ${response.status}`);
      const json = await response.json();
      if (json.error) throw new Error(json.error);
      setData(json as FdcStatus);
      setLastFetched(new Date());
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch FDC status';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-600" />
              FDC Attestation Infrastructure
            </CardTitle>
            <CardDescription>Flare Data Connector status on Coston2</CardDescription>
          </div>
          <Button onClick={fetchData} variant="ghost" size="sm" className="gap-1" disabled={loading}>
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && !data ? (
          <div className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : error && !data ? (
          <div className="p-3 rounded-lg bg-destructive/10 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        ) : (
          <>
            {/* Voting Round & Merkle Root */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Activity className="h-3 w-3" />
                  Current Voting Round
                </span>
                <p className="text-lg font-bold tabular-nums">
                  {data?.currentVotingRound?.toLocaleString() ?? '0'}
                </p>
                {data?.attestorVotingRound && data.attestorVotingRound > 0 && (
                  <p className="text-[10px] text-muted-foreground">
                    Attestor round: {data.attestorVotingRound.toLocaleString()}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Hash className="h-3 w-3" />
                  FDC Merkle Root
                </span>
                {data?.merkleRoot && data.merkleRoot.length > 10 ? (
                  <code className="text-[10px] font-mono block break-all text-muted-foreground">
                    {data.merkleRoot}
                  </code>
                ) : (
                  <p className="text-sm text-muted-foreground">Not available for current round</p>
                )}
              </div>
            </div>

            <Separator />

            {/* Contract Deployment Status */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Contract Deployment
              </p>
              <div className="space-y-1.5">
                {Object.entries(CONTRACT_LABELS).map(([key, info]) => {
                  const deployed = data?.contractsDeployed?.[key] ?? false;
                  return (
                    <div key={key} className="flex items-center gap-2 text-sm">
                      {deployed ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />
                      )}
                      <span className={deployed ? '' : 'text-muted-foreground'}>{info.name}</span>
                      <BlockExplorerLink type="address" value={info.address} truncate={true} />
                    </div>
                  );
                })}
              </div>
            </div>

            {lastFetched && (
              <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Updated {formatDistanceToNow(lastFetched, { addSuffix: true })}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
