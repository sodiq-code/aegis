/**
 * Treasury View
 * 
 * Depositor-facing view showing vault balances, recent actions, and risk score.
 * Reads data from Flare RPC (on-chain) and FCC extension proxy (TEE).
 * 
 * Production polish: skeleton loaders, error states, block explorer links,
 * real data hooks, toast notifications, "last updated" timestamps.
 */

'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { AEGIS_CONTRACTS } from '@/lib/flare-config';
import { BlockExplorerLink } from '@/components/aegis/block-explorer-link';
import { useVaultState, useRiskScore, useVaultEvents } from '@/hooks/use-aegis-data';
import { DepositFlow } from '@/components/aegis/deposit-flow';
import { DepositProductionFlow } from '@/components/aegis/deposit-production-flow';
import { ConfidentialPosition } from '@/components/aegis/confidential-position';
import { RiskRebalance } from '@/components/aegis/risk-rebalance';
import { FdcAttestationPanel } from '@/components/aegis/fdc-attestation-panel';
import { SolvencyChart } from '@/components/aegis/solvency-chart';
import {
  Landmark, AlertTriangle, CheckCircle2, RefreshCw, Shield,
  Activity, Clock, ShieldAlert, ShieldCheck,
  Wallet, FileCheck, Zap, Info
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDistanceToNow } from 'date-fns';
import { useState } from 'react';

export function TreasuryView() {
  const { data: vaultState, loading, error, lastFetched, refetch } = useVaultState();
  const { score: riskScore, loading: riskLoading } = useRiskScore();
  const { events: vaultEvents, loading: eventsLoading } = useVaultEvents();
  const [depositMode, setDepositMode] = useState<'demo' | 'production'>('demo');

  const vault = vaultState?.vault;
  const isConnected = vaultState?.connected ?? false;
  const totalDeposited = vault ? (vault.totalDeposited / 1e6).toFixed(2) : '0.00';
  const _totalValuation = vault ? (vault.totalValuation / 1e6).toFixed(2) : '0.00';
  const xrpPrice = vault?.xrpPrice?.toFixed(4) ?? '0.0000';

  // Use the real on-chain solvency proof's collateral ratio.
  // The /api/vault-state route reads SolvencyRoot.isSolvent() and returns
  // collateralRatio as a percentage (e.g. 166.66). This matches the value
  // the Audit view displays — so Treasury and Audit are always consistent.
  const collateralRatio = vaultState?.solvency?.collateralRatio
    ? Math.round(vaultState.solvency.collateralRatio)
    : 0;
  const minRatio = 150; // 150% from on-chain getMinCollateralRatio()
  const solvencyStatus = collateralRatio >= minRatio ? 'HEALTHY' : collateralRatio >= minRatio * 0.8 ? 'WARNING' : 'CRITICAL';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Landmark className="h-6 w-6 text-emerald-600" />
            Treasury
          </h2>
          <p className="text-muted-foreground">Vault balances, positions, and risk status</p>
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
              Failed to fetch vault data: {error}. Showing last known state.
            </p>
            <Button variant="ghost" size="sm" onClick={refetch} className="ml-auto gap-1 text-xs">
              <RefreshCw className="h-3 w-3" /> Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Connection Status */}
      <div className="flex items-center gap-2 flex-wrap">
        {isConnected ? (
          <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
            <CheckCircle2 className="mr-1 h-3 w-3" /> Connected to Coston2
          </Badge>
        ) : (
          <Badge variant="destructive">
            <AlertTriangle className="mr-1 h-3 w-3" /> Disconnected
          </Badge>
        )}
        {vaultState?.blockNumber && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Activity className="h-3 w-3" />
            Block: {vaultState.blockNumber.toLocaleString()}
          </span>
        )}
      </div>

      {/* Vault Balances */}
      <div className="grid gap-4 md:grid-cols-3">
        {loading && !vaultState ? (
          // Skeleton loaders
          <>
            {['Total Deposited', 'XRP/USD Price', 'Vault Status'].map(label => (
              <Card key={label}>
                <CardHeader className="pb-2">
                  <CardDescription>{label}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-9 w-28" />
                  <Skeleton className="h-3 w-20 mt-2" />
                </CardContent>
              </Card>
            ))}
          </>
        ) : (
          <>
            <Card className="transition-shadow hover:shadow-md">
              <CardHeader className="pb-2">
                <CardDescription>Total Deposited (FXRP)</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold tabular-nums">{totalDeposited}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  &asymp; ${(parseFloat(totalDeposited) * parseFloat(xrpPrice)).toFixed(2)} USD
                </p>
              </CardContent>
            </Card>

            <Card className="transition-shadow hover:shadow-md">
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1">
                  XRP/USD Price
                  <Badge variant="outline" className="text-[10px] px-1 py-0">FTSO V2</Badge>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold tabular-nums">${xrpPrice}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Live from Flare Time Series Oracle
                </p>
              </CardContent>
            </Card>

            <Card className="transition-shadow hover:shadow-md">
              <CardHeader className="pb-2">
                <CardDescription>Vault Status</CardDescription>
              </CardHeader>
              <CardContent>
                {vault?.isEmergency ? (
                  <div className="flex items-center gap-2">
                    <Badge variant="destructive" className="text-sm">EMERGENCY</Badge>
                    <ShieldAlert className="h-5 w-5 text-red-500" />
                  </div>
                ) : vault?.isSafeState ? (
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-sm">SAFE STATE</Badge>
                    <Shield className="h-5 w-5 text-yellow-500" />
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Badge className="bg-emerald-100 text-emerald-800 text-sm dark:bg-emerald-900 dark:text-emerald-200">NORMAL</Badge>
                    <ShieldCheck className="h-5 w-5 text-emerald-500" />
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-2">
                  {vault?.positionCount ?? 0} active position(s)
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Deposit Flow — toggle between demo and production paths */}
      <div className="space-y-3">
        <div className="flex gap-2 p-1 rounded-lg bg-muted/50 w-fit">
          <button
            onClick={() => setDepositMode('demo')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              depositMode === 'demo'
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Demo Path (EVM + FXRP faucet)
          </button>
          <button
            onClick={() => setDepositMode('production')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors inline-flex items-center gap-1 ${
              depositMode === 'production'
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Zap className="h-3 w-3" />
            Production (Xaman → XRPL → FAssets)
          </button>
        </div>
        {depositMode === 'demo' ? <DepositFlow /> : <DepositProductionFlow />}
      </div>

      {/* Confidential Position */}
      <ConfidentialPosition />

      {/* Risk Score & Collateral */}
      <div className="grid gap-4 md:grid-cols-2">
        {loading && !vaultState ? (
          <>
            {[1, 2].map(i => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="h-4 w-40" />
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-7 w-12" />
                  </div>
                  <Skeleton className="h-2 w-full" />
                  <Skeleton className="h-3 w-full" />
                </CardContent>
              </Card>
            ))}
          </>
        ) : (
          <>
            <Card className="transition-shadow hover:shadow-md">
              <CardHeader>
                <CardTitle className="text-base">Risk Score</CardTitle>
                <CardDescription className="flex items-center gap-1">
                  AI risk assessment
                  <Badge variant="outline" className="text-[10px] px-1 py-0">XGBoost in TEE</Badge>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Current Score</span>
                    {riskLoading ? (
                      <Skeleton className="h-7 w-12" />
                    ) : (
                      <span className={`text-2xl font-bold tabular-nums ${
                        (riskScore ?? 0) < 25 ? 'text-emerald-600' :
                        (riskScore ?? 0) < 50 ? 'text-yellow-600' :
                        (riskScore ?? 0) < 75 ? 'text-orange-600' :
                        'text-red-600'
                      }`}>
                        {riskScore?.toFixed(2) ?? '—'}
                      </span>
                    )}
                  </div>
                  <Progress
                    value={riskScore ?? 0}
                    max={100}
                    className={`h-2 ${
                      (riskScore ?? 0) < 25 ? '[&>div]:bg-emerald-500' :
                      (riskScore ?? 0) < 50 ? '[&>div]:bg-yellow-500' :
                      (riskScore ?? 0) < 75 ? '[&>div]:bg-orange-500' :
                      '[&>div]:bg-red-500'
                    }`}
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Hold (&lt;25)</span>
                    <span>Rebalance (&lt;50)</span>
                    <span>Hedge (&lt;75)</span>
                    <span>Deleverage (&lt;90)</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="transition-shadow hover:shadow-md">
              <CardHeader>
                <CardTitle className="text-base">Solvency Margin</CardTitle>
                <CardDescription className="flex items-center gap-1">
                  Collateral ratio
                  <Badge variant="outline" className="text-[10px] px-1 py-0">on-chain</Badge>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Collateral Ratio</span>
                    <span className={`text-2xl font-bold tabular-nums ${
                      solvencyStatus === 'HEALTHY' ? 'text-emerald-600' :
                      solvencyStatus === 'WARNING' ? 'text-yellow-600' :
                      'text-red-600'
                    }`}>
                      {collateralRatio}%
                    </span>
                  </div>
                  <Progress
                    value={collateralRatio}
                    max={200}
                    className={`h-2 ${
                      solvencyStatus === 'HEALTHY' ? '[&>div]:bg-emerald-500' :
                      solvencyStatus === 'WARNING' ? '[&>div]:bg-yellow-500' :
                      '[&>div]:bg-red-500'
                    }`}
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Min: {minRatio}%</span>
                    <span className={solvencyStatus === 'WARNING' ? 'text-yellow-600 font-medium' : ''}>
                      {solvencyStatus === 'HEALTHY' ? 'Healthy' : solvencyStatus === 'WARNING' ? 'Warning' : 'Critical'}
                    </span>
                    <span>Healthy: &gt;{minRatio}%</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Solvency Charts */}
      <SolvencyChart />

      {/* Risk Rebalance */}
      <RiskRebalance />

      {/* Recent Actions */}
      {loading && !vaultState ? (
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-4 w-40" />
          </CardHeader>
          <CardContent className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-4 w-4 rounded-full" />
                  <div className="space-y-1">
                    <Skeleton className="h-4 w-36" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                </div>
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : (
        <Card className="transition-shadow hover:shadow-md">
          <CardHeader>
            <CardTitle className="text-base">Recent Actions</CardTitle>
            <CardDescription>Latest vault operations (on-chain)</CardDescription>
          </CardHeader>
          <CardContent>
            {eventsLoading && vaultEvents.length === 0 ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="flex items-center gap-3 py-2">
                    <Skeleton className="h-4 w-4 rounded-full" />
                    <div className="space-y-1 flex-1">
                      <Skeleton className="h-4 w-36" />
                      <Skeleton className="h-3 w-48" />
                    </div>
                  </div>
                ))}
              </div>
            ) : vaultEvents.length > 0 ? (
              <div className="space-y-0">
                {vaultEvents.slice(0, 10).map((event, i) => {
                  // Map event type to icon
                  const eventIconMap: Record<string, typeof FileCheck> = {
                    'FXRP Deposit': Wallet,
                    'Solvency Proof Published': FileCheck,
                    'Position Revalued': Zap,
                    'FDC Attestation (XRPL)': ShieldCheck,
                    'Risk Assessment': Zap,
                    'Emergency Mode Entered': ShieldAlert,
                    'Safe State Entered': ShieldCheck,
                    'Vault Event': Activity,
                    'Solvency Event': FileCheck,
                  };
                  const EventIcon = eventIconMap[event.type] || Activity;
                  // Build detail line from event.details
                  const detailParts: string[] = [];
                  if (event.details.amount) detailParts.push(event.details.amount);
                  if (event.details.depositor) detailParts.push(`from ${event.details.depositor}`);
                  if (event.details.merkleRoot) detailParts.push(`Root: ${event.details.merkleRoot}`);
                  if (event.details.valuation) detailParts.push(event.details.valuation);
                  if (event.details.positionId) detailParts.push(`Pos #${event.details.positionId}`);
                  const detailLine = detailParts.length > 0 ? detailParts.join(' · ') : '';

                  const timeAgo = event.timestamp && event.timestamp > 0
                    ? formatDistanceToNow(new Date(event.timestamp * 1000), { addSuffix: true })
                    : null;

                  return (
                    <div key={i} className="flex items-center justify-between py-2.5 border-b last:border-0 hover:bg-muted/30 -mx-2 px-2 rounded transition-colors">
                      <div className="flex items-center gap-3">
                        <EventIcon className="h-4 w-4 text-emerald-500 shrink-0" />
                        <div>
                          <p className="text-sm font-medium">{event.type}</p>
                          <p className="text-xs text-muted-foreground">
                            {detailLine}
                            {detailLine && event.transactionHash && ' · '}
                            {event.transactionHash && (
                              <BlockExplorerLink type="tx" value={event.transactionHash} />
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="text-right ml-2">
                        <BlockExplorerLink
                          type="block"
                          value={event.blockNumber.toString()}
                          label={`Blk ${event.blockNumber.toLocaleString()}`}
                        />
                        {timeAgo && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">{timeAgo}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-6 text-center text-muted-foreground">
                <Info className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No recent on-chain events found</p>
                <p className="text-xs mt-1">Events will appear when vault actions occur on Coston2</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Contract Deployment Status */}
      {vaultState?.contractsDeployed && (
        <Card className="transition-shadow hover:shadow-md">
          <CardHeader>
            <CardTitle className="text-base">Contract Deployment (Coston2)</CardTitle>
            <CardDescription>On-chain contract verification</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
              {Object.entries(vaultState.contractsDeployed).map(([name, deployed]) => (
                <div key={name} className="flex items-center gap-2 text-sm">
                  {deployed ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
                  )}
                  <span className={deployed ? '' : 'text-muted-foreground'}>{name}</span>
                  {deployed && AEGIS_CONTRACTS[name as keyof typeof AEGIS_CONTRACTS] && (
                    <BlockExplorerLink
                      type="address"
                      value={AEGIS_CONTRACTS[name as keyof typeof AEGIS_CONTRACTS]}
                      truncate={true}
                    />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* FDC Attestation Infrastructure */}
      <FdcAttestationPanel />
    </div>
  );
}
