/**
 * Treasury View — Task 20 (Day 20)
 * 
 * Depositor-facing view showing vault balances, recent actions, and risk score.
 * All data comes from real on-chain contracts on Coston2 via Flare RPC:
 *   - VaultCore: total deposited, position count, vault status
 *   - FTSO V2: live XRP/USD price feed
 *   - SolvencyRoot: solvency status and collateral ratio
 *   - On-chain events: deposits, revaluations, solvency proofs
 *   - FCC extension: risk score (with on-chain heuristic fallback)
 * 
 * Acceptance criterion: Depositor can see vault state and recent rebalances.
 */

'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { AEGIS_CONTRACTS } from '@/lib/flare-config';
import { useVaultState, useVaultEvents, useRiskScore } from '@/hooks/use-vault-data';
import {
  Landmark,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Shield,
  TrendingUp,
  TrendingDown,
  Activity,
  ExternalLink,
  Clock,
  Loader2,
  Wifi,
  WifiOff,
} from 'lucide-react';

// --- Block Explorer Link ---
const BLOCK_EXPLORER = 'https://coston2-explorer.flare.network';

function BlockExplorerLink({ txHash, label }: { txHash: string; label?: string }) {
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

// --- Event type to icon mapping ---
function EventIcon({ type }: { type: string }) {
  if (type.includes('Deposit')) return <TrendingUp className="h-4 w-4 text-emerald-500" />;
  if (type.includes('Revalued') || type.includes('Rebalance')) return <Activity className="h-4 w-4 text-blue-500" />;
  if (type.includes('Solvency')) return <Shield className="h-4 w-4 text-violet-500" />;
  if (type.includes('Emergency')) return <AlertTriangle className="h-4 w-4 text-red-500" />;
  if (type.includes('Safe State')) return <Shield className="h-4 w-4 text-yellow-500" />;
  return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
}

function EventBadge({ type }: { type: string }) {
  if (type.includes('Deposit')) return <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200 text-xs">Deposit</Badge>;
  if (type.includes('Revalued') || type.includes('Rebalance')) return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 text-xs">Rebalance</Badge>;
  if (type.includes('Solvency')) return <Badge className="bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200 text-xs">Proof</Badge>;
  if (type.includes('Emergency')) return <Badge variant="destructive" className="text-xs">Emergency</Badge>;
  if (type.includes('Safe State')) return <Badge variant="secondary" className="text-xs">Safe</Badge>;
  return <Badge variant="outline" className="text-xs">{type}</Badge>;
}

// --- Main Treasury View ---
export function TreasuryView() {
  const { data: vaultState, loading: vaultLoading, error: vaultError, refetch: refetchVault } = useVaultState();
  const { events, loading: eventsLoading, error: eventsError, refetch: refetchEvents } = useVaultEvents();
  const { data: riskScore, loading: riskLoading, refetch: refetchRisk } = useRiskScore();

  const isRefreshing = vaultLoading || eventsLoading || riskLoading;

  const handleRefresh = () => {
    refetchVault();
    refetchEvents();
    refetchRisk();
  };

  const vault = vaultState?.vault;
  const isConnected = vaultState?.connected ?? false;
  const solvency = vaultState?.solvency;

  // Format values
  const totalDeposited = vault ? (vault.totalDeposited / 1e6).toFixed(2) : '0.00';
  const totalValuation = vault ? (vault.totalValuation / 1e6).toFixed(2) : '0.00';
  const xrpPrice = vault?.xrpPrice?.toFixed(4) ?? '—';
  const collateralRatio = solvency?.collateralRatio ?? 0;
  const isSolvent = solvency?.solvent ?? false;

  // Risk score color
  const riskScoreValue = riskScore.score;
  const riskColor = riskScoreValue < 25 ? 'text-emerald-600' :
                    riskScoreValue < 50 ? 'text-yellow-600' :
                    riskScoreValue < 75 ? 'text-orange-600' : 'text-red-600';

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
        <Button onClick={handleRefresh} variant="outline" size="sm" className="gap-2" disabled={isRefreshing}>
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Connection & Network Status */}
      <div className="flex items-center gap-3 flex-wrap">
        {isConnected ? (
          <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
            <Wifi className="mr-1 h-3 w-3" /> Connected to Coston2
          </Badge>
        ) : (
          <Badge variant="destructive">
            <WifiOff className="mr-1 h-3 w-3" /> Disconnected
          </Badge>
        )}
        {vaultState?.chainId && (
          <Badge variant="outline" className="text-xs">
            Chain {vaultState.chainId}
          </Badge>
        )}
        {vaultState?.blockNumber && (
          <span className="text-xs text-muted-foreground">
            Block: {vaultState.blockNumber.toLocaleString()}
          </span>
        )}
        {vaultError && (
          <Badge variant="destructive" className="text-xs">
            RPC Error: {vaultError}
          </Badge>
        )}
      </div>

      {/* Vault Balances Grid */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Total Deposited */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Deposited (FXRP)</CardDescription>
          </CardHeader>
          <CardContent>
            {vaultLoading ? (
              <div className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /><span className="text-muted-foreground text-sm">Loading...</span></div>
            ) : (
              <>
                <div className="text-3xl font-bold">{totalDeposited}</div>
                {vault?.xrpPrice ? (
                  <p className="text-xs text-muted-foreground mt-1">
                    ≈ ${(parseFloat(totalDeposited) * vault.xrpPrice).toFixed(2)} USD
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1">— USD valuation</p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* XRP/USD Price from FTSO V2 */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>XRP/USD Price (FTSO V2)</CardDescription>
          </CardHeader>
          <CardContent>
            {vaultLoading ? (
              <div className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /><span className="text-muted-foreground text-sm">Loading...</span></div>
            ) : (
              <>
                <div className="text-3xl font-bold">${xrpPrice}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Live from Flare Time Series Oracle • Feed ID: {AEGIS_CONTRACTS.VaultCore ? 'XRP/USD' : '—'}
                </p>
                {vault?.xrpPrice && vault.xrpPrice > 0 && (
                  <Badge variant="outline" className="mt-2 text-xs">
                    <TrendingUp className="mr-1 h-3 w-3 text-emerald-500" /> Live
                  </Badge>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Vault Status */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Vault Status</CardDescription>
          </CardHeader>
          <CardContent>
            {vaultLoading ? (
              <div className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /></div>
            ) : (
              <>
                {vault?.isEmergency ? (
                  <div className="flex items-center gap-2">
                    <Badge variant="destructive" className="text-sm">EMERGENCY</Badge>
                    <AlertTriangle className="h-5 w-5 text-red-500" />
                  </div>
                ) : vault?.isSafeState ? (
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-sm">SAFE STATE</Badge>
                    <Shield className="h-5 w-5 text-yellow-500" />
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Badge className="bg-emerald-100 text-emerald-800 text-sm">NORMAL</Badge>
                    <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-2">
                  {vault?.positionCount ?? 0} active position(s)
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Risk Score & Solvency Margin */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Risk Score */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Risk Score</CardTitle>
            <CardDescription>
              AI risk assessment • {riskScore.source === 'extension' ? 'XGBoost in TEE' : 'On-chain heuristic'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm">Current Score</span>
                <span className={`text-2xl font-bold ${riskColor}`}>
                  {riskLoading ? '—' : riskScoreValue.toFixed(1)}
                </span>
              </div>
              <Progress value={riskScoreValue} max={100} className="h-2" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Hold (&lt;{riskScore.thresholds.hold})</span>
                <span>Rebalance (&lt;{riskScore.thresholds.rebalance})</span>
                <span>Hedge (&lt;{riskScore.thresholds.hedge})</span>
                <span>Deleverage (&lt;{riskScore.thresholds.deleverage})</span>
              </div>
              <Separator />
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Recommended Action</span>
                <Badge variant={riskScore.action === 'Hold' ? 'secondary' : riskScore.action === 'Deleverage' ? 'destructive' : 'outline'}>
                  {riskScore.action}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Confidence</span>
                <span>{(riskScore.confidence * 100).toFixed(0)}%</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Source</span>
                <Badge variant="outline" className="text-xs">
                  {riskScore.source === 'extension' ? 'TEE Extension' : 'On-chain'}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Solvency Margin */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Solvency Margin</CardTitle>
            <CardDescription>Collateral ratio from on-chain proof (SolvencyRoot)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm">Collateral Ratio</span>
                <span className={`text-2xl font-bold ${
                  collateralRatio >= 150 ? 'text-emerald-600' :
                  collateralRatio >= 120 ? 'text-yellow-600' : 'text-red-600'
                }`}>
                  {collateralRatio > 0 ? `${collateralRatio.toFixed(0)}%` : '—'}
                </span>
              </div>
              <Progress value={Math.min(collateralRatio, 200)} max={200} className="h-2" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Min: 150%</span>
                <span className={collateralRatio >= 150 ? 'text-emerald-600' : 'text-yellow-600'}>
                  {isSolvent ? 'Solvent ✓' : collateralRatio > 0 ? 'Below min' : 'No proof'}
                </span>
                <span>Healthy: &gt;150%</span>
              </div>
              <Separator />
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Solvency Status</span>
                {isSolvent ? (
                  <Badge className="bg-emerald-100 text-emerald-800 text-xs">SOLVENT</Badge>
                ) : collateralRatio > 0 ? (
                  <Badge variant="destructive" className="text-xs">INSOLVENT</Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs">NO PROOF</Badge>
                )}
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Contract</span>
                <a
                  href={`${BLOCK_EXPLORER}/address/${AEGIS_CONTRACTS.SolvencyRoot}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                >
                  {`${AEGIS_CONTRACTS.SolvencyRoot.slice(0, 8)}...`}
                  <ExternalLink className="inline h-3 w-3 ml-1" />
                </a>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Actions / Events Log */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Recent Actions</CardTitle>
              <CardDescription>Latest vault operations from on-chain events</CardDescription>
            </div>
            {eventsLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
        </CardHeader>
        <CardContent>
          {eventsError && (
            <div className="text-xs text-destructive mb-3">Error fetching events: {eventsError}</div>
          )}
          {events.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No recent vault events found</p>
              <p className="text-xs mt-1">Events will appear here when deposits, revaluations, or solvency proofs occur</p>
            </div>
          ) : (
            <div className="space-y-1">
              {events.map((event, i) => (
                <div key={`${event.blockNumber}-${event.transactionHash}-${i}`}
                  className="flex items-start justify-between py-2 border-b last:border-0 gap-3"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <EventIcon type={event.type} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{event.type}</p>
                        <EventBadge type={event.type} />
                      </div>
                      <div className="text-xs text-muted-foreground space-y-0.5 mt-0.5">
                        {Object.entries(event.details).map(([key, value]) => (
                          <p key={key}>
                            <span className="font-medium">{key}:</span> {value}
                          </p>
                        ))}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <BlockExplorerLink txHash={event.transactionHash} />
                        <span className="text-xs text-muted-foreground">Block {event.blockNumber.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {event.timestamp
                        ? new Date(event.timestamp * 1000).toLocaleTimeString()
                        : `#${event.blockNumber}`
                      }
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Contract Deployment Status */}
      {vaultState?.contractsDeployed && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contract Deployment (Coston2)</CardTitle>
            <CardDescription>On-chain contract verification — live from Flare RPC</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Object.entries(vaultState.contractsDeployed).map(([name, deployed]) => (
                <div key={name} className="flex items-center gap-2 text-sm">
                  {deployed ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-red-500" />
                  )}
                  <a
                    href={`${BLOCK_EXPLORER}/address/${AEGIS_CONTRACTS[name as keyof typeof AEGIS_CONTRACTS]}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`hover:underline ${deployed ? '' : 'text-muted-foreground'}`}
                  >
                    {name}
                  </a>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Vault Core Details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vault Details</CardTitle>
          <CardDescription>Detailed vault state from VaultCore on Coston2</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">Total FXRP Deposited</p>
              <p className="font-medium">{totalDeposited} FXRP</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Total USD Valuation</p>
              <p className="font-medium">{vault?.totalValuation ? `$${totalValuation}` : '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">XRP/USD (FTSO V2)</p>
              <p className="font-medium">${xrpPrice}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Active Positions</p>
              <p className="font-medium">{vault?.positionCount ?? 0}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Emergency Mode</p>
              <p className="font-medium">{vault?.isEmergency ? '⚠️ YES' : 'No'}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Safe State</p>
              <p className="font-medium">{vault?.isSafeState ? '🔒 YES' : 'No'}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Solvent</p>
              <p className="font-medium">{isSolvent ? '✓ Yes' : collateralRatio > 0 ? '✗ No' : '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Collateral Ratio</p>
              <p className="font-medium">{collateralRatio > 0 ? `${collateralRatio.toFixed(0)}%` : '—'}</p>
            </div>
          </div>
          <Separator className="my-4" />
          <div className="text-xs text-muted-foreground">
            <p>Data source: Flare RPC ({vaultState?.chainId === 114 ? 'Coston2' : `Chain ${vaultState?.chainId}`})</p>
            <p>Last updated: {vaultState?.lastUpdated ? new Date(vaultState.lastUpdated).toLocaleString() : '—'}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
