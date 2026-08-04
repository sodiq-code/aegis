/**
 * Policy View
 * 
 * Depositor-facing view for configuring risk parameters and policy thresholds.
 * Uses real on-chain policy data via the PolicyRegistry contract.
 * 
 * Production polish: loading states, save feedback, validation, toast notifications.
 */

'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { BlockExplorerLink } from '@/components/aegis/block-explorer-link';
import { usePolicyData } from '@/hooks/use-aegis-data';
import { AEGIS_CONTRACTS } from '@/lib/flare-config';
import {
  Shield, AlertTriangle, Save, RotateCcw, Loader2,
  CheckCircle2, Info, ShieldCheck, Lock, Unlock,
  TrendingDown, BarChart3, ArrowRightLeft, Wallet
} from 'lucide-react';

export function PolicyView() {
  const {
    activePreset,
    policy,
    isModified,
    isSaving,
    presets,
    handlePresetChange,
    handleFieldChange,
    handleReset,
    handleSave,
  } = usePolicyData();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Shield className="h-6 w-6 text-emerald-600" />
          Policy
        </h2>
        <p className="text-muted-foreground">Risk parameters and policy thresholds</p>
      </div>

      {/* Policy Presets */}
      <Card className="transition-shadow hover:shadow-md">
        <CardHeader>
          <CardTitle className="text-base">Risk Policy</CardTitle>
          <CardDescription>Select a preset or configure custom parameters</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3 mb-4">
            {Object.entries(presets).map(([key, preset]) => (
              <button
                key={key}
                onClick={() => handlePresetChange(key)}
                className={`p-4 rounded-lg border-2 transition-all text-left group ${
                  activePreset === key
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950 ring-1 ring-emerald-500/20'
                    : 'border-muted hover:border-muted-foreground/30 hover:shadow-sm'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{preset.name}</span>
                  {activePreset === key ? (
                    <Lock className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <Unlock className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-1.5 space-y-0.5">
                  <p className="flex items-center gap-1">
                    <TrendingDown className="h-3 w-3" />
                    Max drawdown: {(preset.maxDrawdownBps / 100).toFixed(0)}%
                  </p>
                  <p className="flex items-center gap-1">
                    <BarChart3 className="h-3 w-3" />
                    Max exposure: {(preset.maxSingleExposureBps / 100).toFixed(0)}%
                  </p>
                </div>
              </button>
            ))}
          </div>

          {isModified && (
            <Badge variant="outline" className="text-yellow-600 border-yellow-300 dark:text-yellow-400 dark:border-yellow-700">
              <AlertTriangle className="mr-1 h-3 w-3" /> Modified from {presets[activePreset]?.name ?? 'preset'}
            </Badge>
          )}
        </CardContent>
      </Card>

      {/* Policy Parameters */}
      <Card className="transition-shadow hover:shadow-md">
        <CardHeader>
          <CardTitle className="text-base">Parameters</CardTitle>
          <CardDescription>The Risk Agent enforces these constraints deterministically</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="maxDrawdown" className="flex items-center gap-1.5">
                <TrendingDown className="h-3.5 w-3.5 text-muted-foreground" />
                Max Drawdown (bps)
              </Label>
              <Input
                id="maxDrawdown"
                type="number"
                value={policy.maxDrawdownBps}
                onChange={(e) => handleFieldChange('maxDrawdownBps', parseInt(e.target.value) || 0)}
                className="tabular-nums"
              />
              <p className="text-xs text-muted-foreground">
                {(policy.maxDrawdownBps / 100).toFixed(0)}% maximum allowed drawdown
                {policy.maxDrawdownBps <= 0 && <span className="text-destructive ml-1">(must be positive)</span>}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="maxExposure" className="flex items-center gap-1.5">
                <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
                Max Single Exposure (bps)
              </Label>
              <Input
                id="maxExposure"
                type="number"
                value={policy.maxSingleExposureBps}
                onChange={(e) => handleFieldChange('maxSingleExposureBps', parseInt(e.target.value) || 0)}
                className="tabular-nums"
              />
              <p className="text-xs text-muted-foreground">
                {(policy.maxSingleExposureBps / 100).toFixed(0)}% maximum single position exposure
                {policy.maxSingleExposureBps > 10000 && <span className="text-destructive ml-1">(exceeds 100%)</span>}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="hedgeThreshold" className="flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                Hedge Threshold (bps)
              </Label>
              <Input
                id="hedgeThreshold"
                type="number"
                value={policy.hedgeThresholdBps}
                onChange={(e) => handleFieldChange('hedgeThresholdBps', parseInt(e.target.value) || 0)}
                className="tabular-nums"
              />
              <p className="text-xs text-muted-foreground">
                Trigger hedging when drawdown exceeds {(policy.hedgeThresholdBps / 100).toFixed(0)}%
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="rebalanceThreshold" className="flex items-center gap-1.5">
                <ArrowRightLeft className="h-3.5 w-3.5 text-muted-foreground" />
                Rebalance Threshold (bps)
              </Label>
              <Input
                id="rebalanceThreshold"
                type="number"
                value={policy.rebalanceThresholdBps}
                onChange={(e) => handleFieldChange('rebalanceThresholdBps', parseInt(e.target.value) || 0)}
                className="tabular-nums"
              />
              <p className="text-xs text-muted-foreground">
                Trigger rebalance when risk score exceeds threshold
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="minDeposit" className="flex items-center gap-1.5">
                <Wallet className="h-3.5 w-3.5 text-muted-foreground" />
                Min Deposit (FXRP)
              </Label>
              <Input
                id="minDeposit"
                type="number"
                value={policy.minDepositAmount}
                onChange={(e) => handleFieldChange('minDepositAmount', parseInt(e.target.value) || 0)}
                className="tabular-nums"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="maxDeposit" className="flex items-center gap-1.5">
                <Wallet className="h-3.5 w-3.5 text-muted-foreground" />
                Max Deposit (FXRP)
              </Label>
              <Input
                id="maxDeposit"
                type="number"
                value={policy.maxDepositAmount}
                onChange={(e) => handleFieldChange('maxDepositAmount', parseInt(e.target.value) || 0)}
                className="tabular-nums"
              />
              {policy.minDepositAmount >= policy.maxDepositAmount && (
                <p className="text-xs text-destructive">Min must be less than max deposit</p>
              )}
            </div>
          </div>

          <Separator />

          <div className="flex items-center gap-2">
            <Button
              className="gap-2 transition-all"
              disabled={!isModified || isSaving}
              onClick={handleSave}
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {isSaving ? 'Saving to chain...' : 'Save Policy'}
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              onClick={handleReset}
              disabled={!isModified || isSaving}
            >
              <RotateCcw className="h-4 w-4" />
              Reset
            </Button>
            {isSaving && (
              <span className="text-xs text-muted-foreground animate-pulse">
                Writing to PolicyRegistry on Coston2...
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Policy Enforcement Info */}
      <Card className="transition-shadow hover:shadow-md">
        <CardHeader>
          <CardTitle className="text-base">Policy Enforcement</CardTitle>
          <CardDescription>How the Policy Engine constrains the AI Risk Agent</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
              <p>The Policy Engine is <strong>deterministic</strong> — the Risk Agent cannot exceed any parameter set here. Policy constraints are enforced on-chain via <BlockExplorerLink type="address" value={AEGIS_CONTRACTS.PolicyRegistry} label="PolicyRegistry" />.</p>
            </div>
            <div className="flex items-start gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
              <p>The agent&apos;s action is validated before execution. If the action violates policy, it is rejected or capped to the maximum allowed value.</p>
            </div>
            <div className="flex items-start gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
              <p>Only the vault <strong>verifier</strong> (registered in <BlockExplorerLink type="address" value={AEGIS_CONTRACTS.VerifierRole} label="VerifierRole" />) can update policy parameters on-chain.</p>
            </div>
            <div className="flex items-start gap-2">
              <Info className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
              <p className="text-muted-foreground">Policy changes take effect in the next Risk Agent cycle. The current cycle continues with the previous policy to prevent mid-action configuration changes.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
