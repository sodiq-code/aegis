/**
 * Policy View
 * 
 * Depositor-facing view for configuring risk parameters and policy thresholds.
 */

'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Shield, AlertTriangle, Save, RotateCcw } from 'lucide-react';

interface PolicyConfig {
  name: string;
  maxDrawdownBps: number;
  maxSingleExposureBps: number;
  hedgeThresholdBps: number;
  rebalanceThresholdBps: number;
  minDepositAmount: number;
  maxDepositAmount: number;
}

const PRESET_POLICIES: Record<string, PolicyConfig> = {
  conservative: {
    name: 'Conservative',
    maxDrawdownBps: 1500,
    maxSingleExposureBps: 3000,
    hedgeThresholdBps: 800,
    rebalanceThresholdBps: 3000,
    minDepositAmount: 100,
    maxDepositAmount: 100000,
  },
  balanced: {
    name: 'Balanced',
    maxDrawdownBps: 2500,
    maxSingleExposureBps: 6000,
    hedgeThresholdBps: 1200,
    rebalanceThresholdBps: 5000,
    minDepositAmount: 50,
    maxDepositAmount: 500000,
  },
  aggressive: {
    name: 'Aggressive',
    maxDrawdownBps: 4000,
    maxSingleExposureBps: 8000,
    hedgeThresholdBps: 2000,
    rebalanceThresholdBps: 7000,
    minDepositAmount: 10,
    maxDepositAmount: 1000000,
  },
};

export function PolicyView() {
  const [activePreset, setActivePreset] = useState<string>('balanced');
  const [policy, setPolicy] = useState<PolicyConfig>(PRESET_POLICIES.balanced);
  const [isModified, setIsModified] = useState(false);

  const handlePresetChange = (preset: string) => {
    setActivePreset(preset);
    setPolicy(PRESET_POLICIES[preset]);
    setIsModified(false);
  };

  const handleFieldChange = (field: keyof PolicyConfig, value: number) => {
    setPolicy(prev => ({ ...prev, [field]: value }));
    setIsModified(true);
  };

  const handleReset = () => {
    if (activePreset in PRESET_POLICIES) {
      setPolicy(PRESET_POLICIES[activePreset]);
      setIsModified(false);
    }
  };

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
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Risk Policy</CardTitle>
          <CardDescription>Select a preset or configure custom parameters</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3 mb-4">
            {Object.entries(PRESET_POLICIES).map(([key, preset]) => (
              <button
                key={key}
                onClick={() => handlePresetChange(key)}
                className={`p-4 rounded-lg border-2 transition-all text-left ${
                  activePreset === key
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950'
                    : 'border-muted hover:border-muted-foreground/30'
                }`}
              >
                <div className="font-medium">{preset.name}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Max drawdown: {(preset.maxDrawdownBps / 100).toFixed(0)}%
                </div>
              </button>
            ))}
          </div>

          {isModified && (
            <Badge variant="outline" className="text-yellow-600 border-yellow-300">
              <AlertTriangle className="mr-1 h-3 w-3" /> Modified from preset
            </Badge>
          )}
        </CardContent>
      </Card>

      {/* Policy Parameters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Parameters</CardTitle>
          <CardDescription>The Risk Agent enforces these constraints deterministically</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="maxDrawdown">Max Drawdown (bps)</Label>
              <Input
                id="maxDrawdown"
                type="number"
                value={policy.maxDrawdownBps}
                onChange={(e) => handleFieldChange('maxDrawdownBps', parseInt(e.target.value) || 0)}
              />
              <p className="text-xs text-muted-foreground">{(policy.maxDrawdownBps / 100).toFixed(0)}% maximum allowed drawdown</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="maxExposure">Max Single Exposure (bps)</Label>
              <Input
                id="maxExposure"
                type="number"
                value={policy.maxSingleExposureBps}
                onChange={(e) => handleFieldChange('maxSingleExposureBps', parseInt(e.target.value) || 0)}
              />
              <p className="text-xs text-muted-foreground">{(policy.maxSingleExposureBps / 100).toFixed(0)}% maximum single position exposure</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="hedgeThreshold">Hedge Threshold (bps)</Label>
              <Input
                id="hedgeThreshold"
                type="number"
                value={policy.hedgeThresholdBps}
                onChange={(e) => handleFieldChange('hedgeThresholdBps', parseInt(e.target.value) || 0)}
              />
              <p className="text-xs text-muted-foreground">Trigger hedging when drawdown exceeds {(policy.hedgeThresholdBps / 100).toFixed(0)}%</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="rebalanceThreshold">Rebalance Threshold (bps)</Label>
              <Input
                id="rebalanceThreshold"
                type="number"
                value={policy.rebalanceThresholdBps}
                onChange={(e) => handleFieldChange('rebalanceThresholdBps', parseInt(e.target.value) || 0)}
              />
              <p className="text-xs text-muted-foreground">Trigger rebalance when risk score exceeds threshold</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="minDeposit">Min Deposit (FXRP)</Label>
              <Input
                id="minDeposit"
                type="number"
                value={policy.minDepositAmount}
                onChange={(e) => handleFieldChange('minDepositAmount', parseInt(e.target.value) || 0)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="maxDeposit">Max Deposit (FXRP)</Label>
              <Input
                id="maxDeposit"
                type="number"
                value={policy.maxDepositAmount}
                onChange={(e) => handleFieldChange('maxDepositAmount', parseInt(e.target.value) || 0)}
              />
            </div>
          </div>

          <Separator />

          <div className="flex items-center gap-2">
            <Button className="gap-2" disabled={!isModified}>
              <Save className="h-4 w-4" />
              Save Policy
            </Button>
            <Button variant="outline" className="gap-2" onClick={handleReset} disabled={!isModified}>
              <RotateCcw className="h-4 w-4" />
              Reset
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Policy Enforcement Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Policy Enforcement</CardTitle>
          <CardDescription>How the Policy Engine constrains the AI Risk Agent</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-2">
              <Shield className="h-4 w-4 text-emerald-500 mt-0.5" />
              <p>The Policy Engine is <strong>deterministic</strong> — the Risk Agent cannot exceed any parameter set here. Policy constraints are enforced on-chain.</p>
            </div>
            <div className="flex items-start gap-2">
              <Shield className="h-4 w-4 text-emerald-500 mt-0.5" />
              <p>The agent&apos;s action is validated before execution. If the action violates policy, it is rejected or capped.</p>
            </div>
            <div className="flex items-start gap-2">
              <Shield className="h-4 w-4 text-emerald-500 mt-0.5" />
              <p>Only the vault <strong>verifier</strong> (registered in VerifierRole) can update policy parameters on-chain.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
