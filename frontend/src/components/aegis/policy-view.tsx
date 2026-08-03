/**
 * Policy View (Configurator)
 * 
 * Depositor-facing view for setting and inspecting risk policies.
 * Reads real on-chain policy data from PolicyRegistry on Coston2.
 * Allows depositors to:
 *  - View all 3 default policies (Conservative, Balanced, Aggressive)
 *  - Select an active policy for their vault
 *  - Inspect all policy parameters (maxDrawdown, maxExposure, hedgeThreshold, etc.)
 *  - Update policy parameters on-chain (via updatePolicy transaction)
 *  - Toggle policy active status on-chain (via setPolicyStatus transaction)
 *  - Validate deposit/withdrawal amounts against the active policy
 */

'use client';

import { useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import {
  Shield, AlertTriangle, Save, RotateCcw, Check, X,
  ExternalLink, RefreshCw, Clock, ToggleLeft, ToggleRight,
  Info, Loader2,
} from 'lucide-react';
import { usePolicyList, usePolicyUpdate, useActionCheck, type OnChainPolicy } from '@/hooks/use-policy-data';
import { AEGIS_CONTRACTS } from '@/lib/flare-config';

const RISK_LEVEL_NAMES = ['Conservative (LOW)', 'Balanced (MEDIUM)', 'Aggressive (HIGH)', 'Emergency (CRITICAL)'] as const;
const RISK_LEVEL_COLORS = ['text-blue-600', 'text-amber-600', 'text-red-600', 'text-red-800'] as const;
const RISK_LEVEL_BG = ['bg-blue-50 dark:bg-blue-950', 'bg-amber-50 dark:bg-amber-950', 'bg-red-50 dark:bg-red-950', 'bg-red-100 dark:bg-red-900'] as const;
const POLICY_ACTION_NAMES = ['ALLOW', 'REQUIRE_APPROVAL', 'DELAY', 'BLOCK'] as const;

export function PolicyView() {
  const { data: policyState, loading, error, refetch } = usePolicyList(30000);
  const { updatePolicy, setPolicyStatus, updating, lastResult } = usePolicyUpdate();
  const { checkAction, checking } = useActionCheck();

  const [selectedPolicyId, setSelectedPolicyId] = useState<number>(1);
  const [editValues, setEditValues] = useState<Record<string, number>>({});
  const [isEditing, setIsEditing] = useState(false);
  const [validationAmount, setValidationAmount] = useState<string>('100000000');
  const [validationResult, setValidationResult] = useState<{ allowed: boolean; actionName: string } | null>(null);

  const policies = policyState?.policies || [];
  const selectedPolicy = policies.find(p => p.policyId === selectedPolicyId) || null;

  // Handle policy selection
  const handleSelectPolicy = useCallback((policyId: number) => {
    setSelectedPolicyId(policyId);
    setIsEditing(false);
    setEditValues({});
    setValidationResult(null);
  }, []);

  // Start editing the selected policy
  const handleStartEdit = useCallback(() => {
    if (!selectedPolicy) return;
    setEditValues({
      maxDrawdownBps: selectedPolicy.maxDrawdownBps,
      maxSingleExposureBps: selectedPolicy.maxSingleExposureBps,
      hedgeThresholdBps: selectedPolicy.hedgeThresholdBps,
      minCollateralRatio: selectedPolicy.minCollateralRatio,
      rebalanceThresholdBps: selectedPolicy.rebalanceThresholdBps,
      maxSlippageBps: selectedPolicy.maxSlippageBps,
      maxDepositPerTx: selectedPolicy.maxDepositPerTx,
      maxWithdrawalPerTx: selectedPolicy.maxWithdrawalPerTx,
      maxTotalExposure: selectedPolicy.maxTotalExposure,
    });
    setIsEditing(true);
  }, [selectedPolicy]);

  // Save edits to on-chain
  const handleSave = useCallback(async () => {
    if (!selectedPolicy) return;
    const changes: string[] = [];
    if (editValues.maxDrawdownBps !== selectedPolicy.maxDrawdownBps) changes.push(`maxDrawdownBps: ${selectedPolicy.maxDrawdownBps} -> ${editValues.maxDrawdownBps}`);
    if (editValues.maxSingleExposureBps !== selectedPolicy.maxSingleExposureBps) changes.push(`maxSingleExposureBps: ${selectedPolicy.maxSingleExposureBps} -> ${editValues.maxSingleExposureBps}`);
    if (editValues.hedgeThresholdBps !== selectedPolicy.hedgeThresholdBps) changes.push(`hedgeThresholdBps: ${selectedPolicy.hedgeThresholdBps} -> ${editValues.hedgeThresholdBps}`);
    if (editValues.minCollateralRatio !== selectedPolicy.minCollateralRatio) changes.push(`minCollateralRatio: ${selectedPolicy.minCollateralRatio} -> ${editValues.minCollateralRatio}`);

    if (changes.length === 0) {
      setIsEditing(false);
      return;
    }

    const fieldChanged = changes.join(', ');
    const result = await updatePolicy(selectedPolicy.policyId, fieldChanged);
    if (result.success) {
      setIsEditing(false);
      setEditValues({});
      refetch();
    }
  }, [selectedPolicy, editValues, updatePolicy, refetch]);

  // Toggle policy active status
  const handleToggleStatus = useCallback(async (policyId: number, currentStatus: boolean) => {
    const result = await setPolicyStatus(policyId, !currentStatus);
    if (result.success) {
      refetch();
    }
  }, [setPolicyStatus, refetch]);

  // Validate a deposit/withdrawal amount
  const handleValidate = useCallback(async () => {
    if (!selectedPolicy) return;
    const amount = parseInt(validationAmount) || 0;
    const result = await checkAction(selectedPolicy.policyId, 'deposit', amount);
    setValidationResult(result);
  }, [selectedPolicy, validationAmount, checkAction]);

  // Format bps as percentage
  const bpsToPercent = (bps: number) => (bps / 100).toFixed(1);

  // Block explorer link
  const explorerTx = (hash: string) => `https://coston2-explorer.flare.network/tx/${hash}`;

  if (loading && !policyState) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
          <span className="text-muted-foreground">Loading policies from PolicyRegistry on Coston2...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="text-red-600">Error loading policies: {error}</div>
        <Button onClick={refetch} variant="outline" className="gap-2">
          <RefreshCw className="h-4 w-4" /> Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Shield className="h-6 w-6 text-emerald-600" />
            Policy Configurator
          </h2>
          <p className="text-muted-foreground">
            Set and inspect risk policies on-chain — PolicyRegistry at{' '}
            <a
              href={`https://coston2-explorer.flare.network/address/${AEGIS_CONTRACTS.PolicyRegistry}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              {AEGIS_CONTRACTS.PolicyRegistry.slice(0, 10)}...
            </a>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-emerald-600 border-emerald-300">
            Coston2
          </Badge>
          <Badge variant="outline">
            {policies.length} policies
          </Badge>
          <Button onClick={refetch} variant="outline" size="sm" className="gap-1">
            <RefreshCw className="h-3 w-3" /> Refresh
          </Button>
        </div>
      </div>

      {/* Policy Selector */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Select Risk Policy</CardTitle>
          <CardDescription>Choose a policy to inspect or configure. These are read from the on-chain PolicyRegistry.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {policies.map((policy) => (
              <button
                key={policy.policyId}
                onClick={() => handleSelectPolicy(policy.policyId)}
                className={`p-4 rounded-lg border-2 transition-all text-left ${
                  selectedPolicyId === policy.policyId
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950'
                    : 'border-muted hover:border-muted-foreground/30'
                } ${!policy.isActive ? 'opacity-60' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <span className={`font-medium ${RISK_LEVEL_COLORS[policy.riskLevel]}`}>
                    {policy.name}
                  </span>
                  {policy.isActive ? (
                    <Check className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <X className="h-4 w-4 text-red-500" />
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Max drawdown: {bpsToPercent(policy.maxDrawdownBps)}% | Min collateral: {bpsToPercent(policy.minCollateralRatio)}%
                </div>
                <div className="text-xs text-muted-foreground">
                  Exposure: {bpsToPercent(policy.maxSingleExposureBps)}% | Hedge: {bpsToPercent(policy.hedgeThresholdBps)}%
                </div>
                {!policy.isActive && (
                  <Badge variant="outline" className="mt-2 text-red-600 border-red-300 text-xs">
                    INACTIVE
                  </Badge>
                )}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Selected Policy Details */}
      {selectedPolicy && (
        <>
          {/* Policy Overview */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Shield className={`h-4 w-4 ${RISK_LEVEL_COLORS[selectedPolicy.riskLevel]}`} />
                    Policy #{selectedPolicy.policyId}: {selectedPolicy.name}
                  </CardTitle>
                  <CardDescription>{selectedPolicy.description}</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={RISK_LEVEL_BG[selectedPolicy.riskLevel]}>
                    {RISK_LEVEL_NAMES[selectedPolicy.riskLevel]}
                  </Badge>
                  <Button
                    onClick={() => handleToggleStatus(selectedPolicy.policyId, selectedPolicy.isActive)}
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    disabled={updating}
                  >
                    {selectedPolicy.isActive ? (
                      <><ToggleRight className="h-4 w-4 text-emerald-500" /> Active</>
                    ) : (
                      <><ToggleLeft className="h-4 w-4 text-red-500" /> Inactive</>
                    )}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Metadata */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Owner</p>
                  <p className="font-mono text-xs/4">{selectedPolicy.owner.slice(0, 10)}...{selectedPolicy.owner.slice(-6)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Created</p>
                  <p>{new Date(selectedPolicy.createdAt * 1000).toLocaleDateString()}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Last Updated</p>
                  <p>{new Date(selectedPolicy.updatedAt * 1000).toLocaleDateString()}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Allowed Assets</p>
                  <p>{selectedPolicy.allowedAssets.length} asset{selectedPolicy.allowedAssets.length !== 1 ? 's' : ''}</p>
                </div>
              </div>

              <Separator />

              {/* Risk Parameters — the core of the configurator */}
              <div>
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  Risk Parameters (enforced by Policy Engine in TEE)
                </h3>
                <div className="grid gap-4 md:grid-cols-2">
                  {/* Max Drawdown */}
                  <div className="space-y-2">
                    <Label htmlFor="maxDrawdown">Max Drawdown</Label>
                    {isEditing ? (
                      <Input
                        id="maxDrawdown"
                        type="number"
                        value={editValues.maxDrawdownBps ?? selectedPolicy.maxDrawdownBps}
                        onChange={(e) => setEditValues(prev => ({ ...prev, maxDrawdownBps: parseInt(e.target.value) || 0 }))}
                      />
                    ) : (
                      <div className="flex items-center gap-2">
                        <Progress value={selectedPolicy.maxDrawdownBps / 100} className="flex-1" />
                        <span className="text-sm font-mono w-16 text-right">{bpsToPercent(selectedPolicy.maxDrawdownBps)}%</span>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">Maximum allowed drawdown before emergency action</p>
                  </div>

                  {/* Max Single Exposure */}
                  <div className="space-y-2">
                    <Label htmlFor="maxExposure">Max Single Exposure</Label>
                    {isEditing ? (
                      <Input
                        id="maxExposure"
                        type="number"
                        value={editValues.maxSingleExposureBps ?? selectedPolicy.maxSingleExposureBps}
                        onChange={(e) => setEditValues(prev => ({ ...prev, maxSingleExposureBps: parseInt(e.target.value) || 0 }))}
                      />
                    ) : (
                      <div className="flex items-center gap-2">
                        <Progress value={selectedPolicy.maxSingleExposureBps / 100} className="flex-1" />
                        <span className="text-sm font-mono w-16 text-right">{bpsToPercent(selectedPolicy.maxSingleExposureBps)}%</span>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">Maximum exposure to a single asset</p>
                  </div>

                  {/* Hedge Threshold */}
                  <div className="space-y-2">
                    <Label htmlFor="hedgeThreshold">Hedge Threshold</Label>
                    {isEditing ? (
                      <Input
                        id="hedgeThreshold"
                        type="number"
                        value={editValues.hedgeThresholdBps ?? selectedPolicy.hedgeThresholdBps}
                        onChange={(e) => setEditValues(prev => ({ ...prev, hedgeThresholdBps: parseInt(e.target.value) || 0 }))}
                      />
                    ) : (
                      <div className="flex items-center gap-2">
                        <Progress value={selectedPolicy.hedgeThresholdBps / 100} className="flex-1" />
                        <span className="text-sm font-mono w-16 text-right">{bpsToPercent(selectedPolicy.hedgeThresholdBps)}%</span>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">Trigger hedging when drawdown exceeds this</p>
                  </div>

                  {/* Min Collateral Ratio */}
                  <div className="space-y-2">
                    <Label htmlFor="minCollateral">Min Collateral Ratio</Label>
                    {isEditing ? (
                      <Input
                        id="minCollateral"
                        type="number"
                        value={editValues.minCollateralRatio ?? selectedPolicy.minCollateralRatio}
                        onChange={(e) => setEditValues(prev => ({ ...prev, minCollateralRatio: parseInt(e.target.value) || 0 }))}
                      />
                    ) : (
                      <div className="flex items-center gap-2">
                        <Progress value={selectedPolicy.minCollateralRatio / 100} className="flex-1" />
                        <span className="text-sm font-mono w-16 text-right">{bpsToPercent(selectedPolicy.minCollateralRatio)}%</span>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">Minimum collateral ratio for solvency</p>
                  </div>

                  {/* Rebalance Threshold */}
                  <div className="space-y-2">
                    <Label htmlFor="rebalanceThreshold">Rebalance Threshold</Label>
                    {isEditing ? (
                      <Input
                        id="rebalanceThreshold"
                        type="number"
                        value={editValues.rebalanceThresholdBps ?? selectedPolicy.rebalanceThresholdBps}
                        onChange={(e) => setEditValues(prev => ({ ...prev, rebalanceThresholdBps: parseInt(e.target.value) || 0 }))}
                      />
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono">{bpsToPercent(selectedPolicy.rebalanceThresholdBps)}%</span>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">Risk score threshold to trigger rebalance</p>
                  </div>

                  {/* Max Slippage */}
                  <div className="space-y-2">
                    <Label htmlFor="maxSlippage">Max Slippage</Label>
                    {isEditing ? (
                      <Input
                        id="maxSlippage"
                        type="number"
                        value={editValues.maxSlippageBps ?? selectedPolicy.maxSlippageBps}
                        onChange={(e) => setEditValues(prev => ({ ...prev, maxSlippageBps: parseInt(e.target.value) || 0 }))}
                      />
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono">{bpsToPercent(selectedPolicy.maxSlippageBps)}%</span>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">Maximum allowed slippage on rebalance</p>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Operational Limits */}
              <div>
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Info className="h-4 w-4 text-blue-500" />
                  Operational Limits
                </h3>
                <div className="grid gap-3 md:grid-cols-3 text-sm">
                  <div className="p-3 rounded-lg border">
                    <p className="text-muted-foreground">Max Deposit/Tx</p>
                    <p className="font-mono">{(selectedPolicy.maxDepositPerTx / 1e6).toFixed(1)} XRP</p>
                  </div>
                  <div className="p-3 rounded-lg border">
                    <p className="text-muted-foreground">Max Withdrawal/Tx</p>
                    <p className="font-mono">{(selectedPolicy.maxWithdrawalPerTx / 1e6).toFixed(1)} XRP</p>
                  </div>
                  <div className="p-3 rounded-lg border">
                    <p className="text-muted-foreground">Max Total Exposure</p>
                    <p className="font-mono">{(selectedPolicy.maxTotalExposure / 1e6).toFixed(0)} XRP</p>
                  </div>
                  <div className="p-3 rounded-lg border">
                    <p className="text-muted-foreground">Max Leverage</p>
                    <p className="font-mono">{(selectedPolicy.maxLeverage / 100).toFixed(0)}x</p>
                  </div>
                  <div className="p-3 rounded-lg border">
                    <p className="text-muted-foreground">Withdrawal Delay</p>
                    <p className="font-mono flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {(selectedPolicy.withdrawalDelaySeconds / 3600).toFixed(0)}h
                    </p>
                  </div>
                  <div className="p-3 rounded-lg border">
                    <p className="text-muted-foreground">On Risk Breach</p>
                    <p className="font-mono">{selectedPolicy.onRiskBreachName}</p>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Edit Controls */}
              <div className="flex items-center gap-2">
                {isEditing ? (
                  <>
                    <Button onClick={handleSave} className="gap-2" disabled={updating}>
                      {updating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      {updating ? 'Saving to chain...' : 'Save to Chain'}
                    </Button>
                    <Button variant="outline" onClick={() => { setIsEditing(false); setEditValues({}); }} className="gap-2">
                      <RotateCcw className="h-4 w-4" /> Cancel
                    </Button>
                  </>
                ) : (
                  <Button onClick={handleStartEdit} className="gap-2">
                    <Save className="h-4 w-4" /> Edit Parameters
                  </Button>
                )}
              </div>

              {/* Transaction Result */}
              {lastResult && (
                <div className={`p-3 rounded-lg text-sm ${lastResult.success ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700' : 'bg-red-50 dark:bg-red-950 text-red-700'}`}>
                  {lastResult.success ? (
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4" />
                      <span>{lastResult.message}</span>
                      {lastResult.transactionHash && (
                        <a
                          href={explorerTx(lastResult.transactionHash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline flex items-center gap-1"
                        >
                          <ExternalLink className="h-3 w-3" /> View tx
                        </a>
                      )}
                    </div>
                  ) : (
                    <span>Error: {lastResult.error}</span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Action Validator */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="h-4 w-4 text-blue-500" />
                Action Validator
              </CardTitle>
              <CardDescription>
                Check if a deposit or withdrawal amount is allowed under the selected policy
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="space-y-1 flex-1">
                  <Label htmlFor="validateAmount">Amount (UBA, 6 decimals)</Label>
                  <Input
                    id="validateAmount"
                    type="number"
                    value={validationAmount}
                    onChange={(e) => setValidationAmount(e.target.value)}
                    placeholder="e.g., 100000000 for 100 XRP"
                  />
                </div>
                <Button
                  onClick={handleValidate}
                  disabled={checking || !validationAmount}
                  className="gap-2 mt-6"
                >
                  {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Validate Deposit
                </Button>
              </div>

              {validationResult && (
                <div className={`p-3 rounded-lg ${validationResult.allowed ? 'bg-emerald-50 dark:bg-emerald-950' : 'bg-red-50 dark:bg-red-950'}`}>
                  <div className="flex items-center gap-2">
                    {validationResult.allowed ? (
                      <Check className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <X className="h-4 w-4 text-red-600" />
                    )}
                    <span className="text-sm">
                      {validationResult.allowed
                        ? `Deposit of ${(parseInt(validationAmount) / 1e6).toFixed(1)} XRP is ALLOWED under Policy #${selectedPolicy.policyId}`
                        : `Deposit of ${(parseInt(validationAmount) / 1e6).toFixed(1)} XRP is ${validationResult.actionName} under Policy #${selectedPolicy.policyId}`
                      }
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Policy Enforcement Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">How Policy Enforcement Works</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-2">
              <Shield className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
              <p>The Policy Engine is <strong>deterministic</strong> — the AI Risk Agent cannot exceed any parameter set here. Policy constraints are enforced on-chain via the PolicyRegistry contract.</p>
            </div>
            <div className="flex items-start gap-2">
              <Shield className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
              <p>Every agent action is validated before execution. If the action violates policy, it is rejected or capped. The <code className="bg-muted px-1 rounded">onRiskBreach</code> and <code className="bg-muted px-1 rounded">onSolvencyWarning</code> fields define what happens on violations.</p>
            </div>
            <div className="flex items-start gap-2">
              <Shield className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
              <p>Only the vault <strong>verifier</strong> (registered in VerifierRole) can update policy parameters on-chain. The deployer address <code className="bg-muted px-1 rounded">0xe37E...b0C4</code> is the current policy owner.</p>
            </div>
            <div className="flex items-start gap-2">
              <Shield className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
              <p>Policy parameters are read by the FCC extension (TEE) on every loop iteration. The <code className="bg-muted px-1 rounded">checkAction()</code> function validates deposits and withdrawals against the active policy in real-time.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
