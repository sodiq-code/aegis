/**
 * Risk Rebalance Component (Layers 3 + 4)
 *
 * Simulates an autonomous risk rebalance triggered by a market drawdown.
 * Shows AI risk agent detecting threshold breach, computing rebalance action,
 * issuing PMW instruction, PMW signing flow, XRPL transaction execution,
 * FDC attestation, and updated solvency root.
 *
 * Demo Script (2:30–3:30): "An AI agent inside a TEE just autonomously rebalanced
 * a private vault across chains, and every step is verifiable."
 */

'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { BlockExplorerLink } from '@/components/aegis/block-explorer-link';
import { AEGIS_CONTRACTS } from '@/lib/flare-config';
import {
  Zap, AlertTriangle, Shield, Loader2, CheckCircle2,
  Brain, ArrowRightLeft, FileCheck, ShieldCheck, Quote
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

type RebalanceStep =
  | 'idle'
  | 'detecting'
  | 'computing'
  | 'issuing-pmw'
  | 'signing-pmw'
  | 'executing-xrpl'
  | 'fdc-attestation'
  | 'solvency-root'
  | 'complete';

interface StepInfo {
  step: RebalanceStep;
  label: string;
  description: string;
  icon: typeof Zap;
}

const STEPS: StepInfo[] = [
  { step: 'detecting', label: 'AI Risk Agent detecting threshold breach', description: 'Monitoring risk score against policy thresholds', icon: Brain },
  { step: 'computing', label: 'Computing rebalance action inside TEE', description: 'XGBoost model determining optimal hedging strategy', icon: Zap },
  { step: 'issuing-pmw', label: 'Issuing PMW instruction', description: 'Creating cross-chain payment instruction via PMWInstructionRelay', icon: ArrowRightLeft },
  { step: 'signing-pmw', label: 'PMW signing — data-provider consensus', description: 'Waiting for data provider signing round', icon: Shield },
  { step: 'executing-xrpl', label: 'PMW signed — executing XRPL transaction', description: 'Submitting payment to XRPL via FDC attestation', icon: FileCheck },
  { step: 'fdc-attestation', label: 'FDC attestation of executed payment', description: 'Flare Data Connector verifying XRPL proof', icon: ShieldCheck },
  { step: 'solvency-root', label: 'Updated solvency root published on-chain', description: 'New Merkle root reflecting rebalanced positions', icon: CheckCircle2 },
];

const STEP_ORDER: RebalanceStep[] = [
  'idle', 'detecting', 'computing', 'issuing-pmw', 'signing-pmw',
  'executing-xrpl', 'fdc-attestation', 'solvency-root', 'complete',
];

function getStepIndex(step: RebalanceStep): number {
  return STEP_ORDER.indexOf(step);
}

const SIMULATED_TX_HASH = '0xa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
const SIMULATED_ATTESTATION_HASH = '0xd4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5';
const SIMULATED_NEW_ROOT = '0xf6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8';

export function RiskRebalance() {
  const [currentStep, setCurrentStep] = useState<RebalanceStep>('idle');
  const [riskScore, setRiskScore] = useState(7.52);
  const [animatingRisk, setAnimatingRisk] = useState(false);
  const animationRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isRunning = currentStep !== 'idle' && currentStep !== 'complete';
  const currentStepIndex = getStepIndex(currentStep);

  const simulateDelay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

  const animateRiskScore = useCallback((from: number, to: number, duration: number) => {
    return new Promise<void>(resolve => {
      setAnimatingRisk(true);
      const startTime = Date.now();
      const interval = 50;
      animationRef.current = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const current = from + (to - from) * progress;
        setRiskScore(current);
        if (progress >= 1) {
          if (animationRef.current) clearInterval(animationRef.current);
          setAnimatingRisk(false);
          resolve();
        }
      }, interval);
    });
  }, []);

  const handleSimulateDrawdown = useCallback(async () => {
    setCurrentStep('detecting');

    // Animate risk score from 7.52 to 65
    await animateRiskScore(7.52, 65, 2000);
    await simulateDelay(500);
    setCurrentStep('computing');

    // Computing rebalance
    await simulateDelay(2000);
    setCurrentStep('issuing-pmw');

    // Issuing PMW
    await simulateDelay(1500);
    setCurrentStep('signing-pmw');

    // PMW signing
    await simulateDelay(2000);
    setCurrentStep('executing-xrpl');

    // XRPL execution
    await simulateDelay(1500);
    setCurrentStep('fdc-attestation');

    // FDC attestation
    await simulateDelay(1500);
    setCurrentStep('solvency-root');

    // Solvency root update
    await simulateDelay(1500);
    setCurrentStep('complete');

    // Animate risk score back down to ~12
    await animateRiskScore(65, 12, 1500);
  }, [animateRiskScore]);

  const handleReset = useCallback(() => {
    setCurrentStep('idle');
    setRiskScore(7.52);
  }, []);

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) clearInterval(animationRef.current);
    };
  }, []);

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Brain className="h-5 w-5 text-emerald-600" />
          Autonomous Risk Rebalance
          <Badge variant="outline" className="text-[10px] px-1 py-0">Layers 3+4</Badge>
        </CardTitle>
        <CardDescription>
          AI-driven rebalance triggered by threshold breach — fully autonomous and verifiable
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Trigger Button & Risk Score Display */}
        <div className="flex items-center gap-4">
          <Button
            onClick={handleSimulateDrawdown}
            disabled={isRunning || currentStep === 'complete'}
            variant={currentStep === 'idle' ? 'default' : 'outline'}
            className="gap-2 shrink-0 transition-all"
          >
            {isRunning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <AlertTriangle className="h-4 w-4" />
            )}
            {currentStep === 'idle' ? 'Simulate Market Drawdown' : 'Rebalancing...'}
          </Button>

          <div className="flex-1 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Risk Score</span>
              <span className={`text-sm font-bold tabular-nums ${
                riskScore < 25 ? 'text-emerald-600' :
                riskScore < 50 ? 'text-yellow-600' :
                riskScore < 75 ? 'text-orange-600' :
                'text-red-600'
              }`}>
                {riskScore.toFixed(2)}
              </span>
            </div>
            <Progress
              value={riskScore}
              max={100}
              className={`h-2 ${
                riskScore < 25 ? '[&>div]:bg-emerald-500' :
                riskScore < 50 ? '[&>div]:bg-yellow-500' :
                riskScore < 75 ? '[&>div]:bg-orange-500' :
                '[&>div]:bg-red-500'
              }`}
            />
          </div>
        </div>

        {/* Rebalance Action (shown during computing step and after) */}
        <AnimatePresence>
          {currentStepIndex >= getStepIndex('computing') && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="p-3 rounded-lg bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-900 space-y-1"
            >
              <p className="text-xs font-medium text-orange-800 dark:text-orange-200">
                Computed Rebalance Action
              </p>
              <div className="text-xs text-orange-700 dark:text-orange-300 space-y-0.5">
                <p>• Reduce FXRP exposure by 30% (sell 210,000 FXRP)</p>
                <p>• Hedge remaining exposure via XRPL escrow (40% coverage)</p>
                <p>• Rebalance from risk score 65.00 → target ~12.00</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Step Progress */}
        <AnimatePresence>
          {currentStep !== 'idle' && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-2"
            >
              <Separator />
              {STEPS.map((stepInfo, idx) => {
                const stepIdx = getStepIndex(stepInfo.step);
                const isActive = stepIdx === currentStepIndex;
                const isDone = stepIdx < currentStepIndex;
                const StepIcon = stepInfo.icon;

                return (
                  <motion.div
                    key={stepInfo.step}
                    initial={isActive ? { opacity: 0, x: -10 } : {}}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.03 }}
                    className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${
                      isActive ? 'bg-emerald-50 dark:bg-emerald-950/50' :
                      isDone ? 'opacity-70' :
                      'opacity-40'
                    }`}
                  >
                    {isDone ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                    ) : isActive ? (
                      <Loader2 className="h-4 w-4 text-emerald-500 animate-spin shrink-0" />
                    ) : (
                      <StepIcon className="h-4 w-4 text-muted-foreground/30 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${isDone ? 'text-emerald-700 dark:text-emerald-300' : ''}`}>
                        {stepInfo.label}
                      </p>
                      <p className="text-xs text-muted-foreground">{stepInfo.description}</p>
                    </div>
                    {isActive && (
                      <Badge variant="outline" className="text-emerald-600 border-emerald-300 text-[10px] shrink-0">
                        Active
                      </Badge>
                    )}
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Verification Links (shown after XRPL execution) */}
        <AnimatePresence>
          {currentStepIndex >= getStepIndex('executing-xrpl') && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="p-3 rounded-lg bg-muted/50 space-y-2"
            >
              <p className="text-xs font-medium">Verification Details</p>
              <div className="text-xs text-muted-foreground space-y-1">
                <p className="flex items-center gap-1">
                  <span className="font-medium">XRPL TX:</span>
                  <code className="font-mono text-[10px]">{SIMULATED_TX_HASH.slice(0, 20)}...</code>
                </p>
                {currentStepIndex >= getStepIndex('fdc-attestation') && (
                  <p className="flex items-center gap-1">
                    <span className="font-medium">FDC Attestation:</span>
                    <code className="font-mono text-[10px]">{SIMULATED_ATTESTATION_HASH.slice(0, 20)}...</code>
                  </p>
                )}
                {currentStepIndex >= getStepIndex('solvency-root') && (
                  <div className="space-y-1">
                    <p className="flex items-center gap-1">
                      <span className="font-medium">New Solvency Root:</span>
                      <code className="font-mono text-[10px]">{SIMULATED_NEW_ROOT.slice(0, 20)}...</code>
                    </p>
                    <p className="flex items-center gap-1">
                      <span className="font-medium">SolvencyRoot Contract:</span>
                      <BlockExplorerLink type="address" value={AEGIS_CONTRACTS.SolvencyRoot} />
                    </p>
                    <p className="flex items-center gap-1">
                      <span className="font-medium">PMWInstructionRelay:</span>
                      <BlockExplorerLink type="address" value={AEGIS_CONTRACTS.PMWInstructionRelay} />
                    </p>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Complete State */}
        <AnimatePresence>
          {currentStep === 'complete' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-3"
            >
              <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                  <p className="font-medium text-emerald-800 dark:text-emerald-200">
                    Rebalance Complete
                  </p>
                </div>
                <div className="text-xs text-emerald-700 dark:text-emerald-300 space-y-1">
                  <p>Risk score reduced: 65.00 → {riskScore.toFixed(2)}</p>
                  <p>Positions rebalanced across XRPL + Flare</p>
                  <p>All steps verifiable on-chain</p>
                </div>
              </div>

              <Button variant="outline" size="sm" onClick={handleReset} className="gap-2">
                Reset Simulation
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        <Separator />

        {/* Quote */}
        <div className="flex items-start gap-2 text-xs text-muted-foreground italic">
          <Quote className="h-3 w-3 shrink-0 mt-0.5 text-emerald-500" />
          <p>An AI agent inside a TEE just autonomously rebalanced a private vault across chains, and every step is verifiable.</p>
        </div>
      </CardContent>
    </Card>
  );
}
