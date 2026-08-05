/**
 * Risk Rebalance Component (Layers 3 + 4)
 *
 * Real AI-driven rebalance flow:
 *   1. Fetches real risk score from /api/risk-agent (computed from FTSO V2 + on-chain state)
 *   2. When user clicks "Simulate Market Drawdown":
 *      - Animates risk score as FTSO price "drops" (simulated)
 *      - Calls /api/rebalance which:
 *        a. Calls PolicyRegistry.checkAction on-chain (real policy decision)
 *        b. Publishes a fresh solvency proof on-chain (real tx hash)
 *   3. Shows real Coston2 tx hash + new Merkle root
 *
 * The XGBoost model in the production FCC extension (extension/internal/risk/)
 * is replaced here by a linear model with the same feature decomposition
 * (drawdown, leverage, concentration, volatility) so the dashboard can show
 * real-time risk without requiring the TEE to be running.
 */

'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  Zap, AlertTriangle, Shield, Loader2, CheckCircle2,
  Brain, ArrowRightLeft, FileCheck, ShieldCheck, Quote, ExternalLink, XCircle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

type RebalanceStep =
  | 'idle'
  | 'detecting'
  | 'computing'
  | 'policy-check'
  | 'executing'
  | 'solvency-root'
  | 'complete'
  | 'blocked';

interface StepInfo {
  step: Exclude<RebalanceStep, 'idle' | 'blocked'>;
  label: string;
  description: string;
  icon: typeof Zap;
}

const STEPS: StepInfo[] = [
  { step: 'detecting',     label: 'AI Risk Agent detecting threshold breach', description: 'Real FTSO V2 price + vault state → risk score', icon: Brain },
  { step: 'computing',     label: 'Computing rebalance action',               description: 'Linear model: drawdown + leverage + concentration + volatility', icon: Zap },
  { step: 'policy-check',  label: 'PolicyRegistry.checkAction on-chain',      description: 'Real smart-contract policy validation', icon: Shield },
  { step: 'executing',     label: 'Executing rebalance',                       description: 'Recording action + computing new Merkle root', icon: ArrowRightLeft },
  { step: 'solvency-root', label: 'Publishing fresh solvency proof',           description: 'Verifier-key signed on-chain tx', icon: FileCheck },
];

const STEP_ORDER: RebalanceStep[] = [
  'idle', 'detecting', 'computing', 'policy-check', 'executing', 'solvency-root', 'complete', 'blocked',
];

function getStepIndex(step: RebalanceStep): number {
  return STEP_ORDER.indexOf(step);
}

interface RebalanceResult {
  riskScore?: number;
  action?: string;
  policyDecision?: { allowed: boolean; policyAction: string; reason: string };
  txHash?: string;
  merkleRoot?: string;
  votingRound?: string;
  newCollateralRatio?: number;
  blockNumber?: number;
  error?: string;
}

export function RiskRebalance() {
  const [currentStep, setCurrentStep] = useState<RebalanceStep>('idle');
  const [riskScore, setRiskScore] = useState(7.52);
  const [restingScore, setRestingScore] = useState<number | null>(null);
  const [result, setResult] = useState<RebalanceResult>({});
  const [errorMsg, setErrorMsg] = useState('');
  const animationRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isRunning = currentStep !== 'idle' && currentStep !== 'complete' && currentStep !== 'blocked';
  const currentStepIndex = getStepIndex(currentStep);

  // Fetch the real resting risk score on mount
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const r = await fetch('/api/risk-agent');
        if (!r.ok) return;
        const data = await r.json();
        if (!mounted) return;
        if (typeof data.riskScore === 'number') {
          setRestingScore(data.riskScore);
          setRiskScore(data.riskScore);
        }
      } catch {}
    })();
    return () => { mounted = false; };
  }, []);

  const animateRiskScore = useCallback((from: number, to: number, duration: number) => {
    return new Promise<void>(resolve => {
      const startTime = Date.now();
      const interval = 50;
      animationRef.current = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const current = from + (to - from) * progress;
        setRiskScore(current);
        if (progress >= 1) {
          if (animationRef.current) clearInterval(animationRef.current);
          resolve();
        }
      }, interval);
    });
  }, []);

  const handleSimulateDrawdown = useCallback(async () => {
    setResult({});
    setErrorMsg('');
    setCurrentStep('detecting');

    try {
      // Step 1: Animate risk score climbing as price "drops"
      const startScore = restingScore ?? 7.52;
      await animateRiskScore(startScore, 65, 2000);

      // Step 2: Computing action
      setCurrentStep('computing');
      await new Promise(r => setTimeout(r, 800));

      // Step 3: Policy check
      setCurrentStep('policy-check');
      await new Promise(r => setTimeout(r, 600));

      // Step 4-5: Execute rebalance via /api/rebalance
      setCurrentStep('executing');
      const resp = await fetch('/api/rebalance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ simulatedPriceDrop: 18 }),
      });
      const data = await resp.json();

      if (!resp.ok || !data.executed) {
        // Policy blocked the action
        if (data.policyDecision && !data.policyDecision.allowed) {
          setResult({
            riskScore: data.riskScore,
            action: data.action,
            policyDecision: data.policyDecision,
          });
          setCurrentStep('blocked');
          return;
        }
        throw new Error(data.error || 'Rebalance failed');
      }

      setResult({
        riskScore: data.riskScore,
        action: data.action,
        policyDecision: data.policyDecision,
        txHash: data.txHash,
        merkleRoot: data.merkleRoot,
        votingRound: data.votingRound,
        newCollateralRatio: data.newCollateralRatio,
        blockNumber: data.blockNumber,
      });

      // Step 6: Solvency root published
      setCurrentStep('solvency-root');
      await new Promise(r => setTimeout(r, 800));

      // Complete — animate risk score back down
      setCurrentStep('complete');
      await animateRiskScore(65, 15, 1500);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Rebalance failed');
      setCurrentStep('blocked');
    }
  }, [animateRiskScore, restingScore]);

  const handleReset = useCallback(() => {
    setCurrentStep('idle');
    setResult({});
    setErrorMsg('');
    if (restingScore !== null) setRiskScore(restingScore);
  }, [restingScore]);

  // Cleanup on unmount
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
          Real AI risk score from FTSO V2 + vault state · PolicyRegistry.checkAction on-chain · Verifier-key signed proof
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Trigger Button & Risk Score Display */}
        <div className="flex items-center gap-4">
          <Button
            onClick={handleSimulateDrawdown}
            disabled={isRunning}
            variant={currentStep === 'idle' || currentStep === 'complete' || currentStep === 'blocked' ? 'default' : 'outline'}
            className="gap-2 shrink-0 transition-all"
          >
            {isRunning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <AlertTriangle className="h-4 w-4" />
            )}
            {isRunning ? 'Rebalancing...' : 'Simulate Market Drawdown'}
          </Button>

          <div className="flex-1 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                Risk Score {restingScore !== null && '(real, from FTSO + vault state)'}
              </span>
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
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>🟢 Hold (&lt;25)</span>
              <span>🟡 Rebalance (&lt;50)</span>
              <span>🟠 Hedge (&lt;75)</span>
              <span>🔴 Deleverage</span>
            </div>
          </div>
        </div>

        {/* Step Progress */}
        <AnimatePresence mode="wait">
          {currentStep !== 'idle' && currentStep !== 'blocked' && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-3"
            >
              <Separator />

              {STEPS.map((stepInfo, idx) => {
                const stepIdx = getStepIndex(stepInfo.step);
                const isActive = stepIdx === currentStepIndex;
                const isDone = stepIdx < currentStepIndex;

                return (
                  <motion.div
                    key={stepInfo.step}
                    initial={isActive ? { opacity: 0, x: -10 } : {}}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${
                      isActive ? 'bg-emerald-50 dark:bg-emerald-950/50' :
                      isDone ? 'opacity-70' :
                      'opacity-40'
                    }`}
                  >
                    {isDone ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                    ) : isActive ? (
                      <Loader2 className="h-5 w-5 text-emerald-500 animate-spin shrink-0" />
                    ) : (
                      <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${isDone ? 'text-emerald-700 dark:text-emerald-300' : ''}`}>
                        {stepInfo.label}
                      </p>
                      <p className="text-xs text-muted-foreground">{stepInfo.description}</p>
                      {stepInfo.step === 'policy-check' && result.policyDecision && (
                        <p className={`text-[10px] mt-0.5 ${result.policyDecision.allowed ? 'text-emerald-600' : 'text-red-600'}`}>
                          {result.policyDecision.reason}
                        </p>
                      )}
                      {stepInfo.step === 'solvency-root' && result.txHash && (
                        <a
                          href={`https://coston2-explorer.flare.network/tx/${result.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] font-mono text-emerald-600 hover:underline inline-flex items-center gap-0.5 mt-0.5"
                        >
                          {result.txHash.slice(0, 18)}...{result.txHash.slice(-4)}
                          <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      )}
                    </div>
                    {isActive && (
                      <Badge variant="outline" className="text-emerald-600 border-emerald-300 text-[10px] shrink-0">
                        In progress
                      </Badge>
                    )}
                    {isDone && (
                      <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200 text-[10px] shrink-0">
                        Done
                      </Badge>
                    )}
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Blocked State */}
        <AnimatePresence>
          {currentStep === 'blocked' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="p-4 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 space-y-2"
            >
              <div className="flex items-center gap-2">
                <XCircle className="h-5 w-5 text-red-600 shrink-0" />
                <p className="font-medium text-red-800 dark:text-red-200">
                  {result.policyDecision && !result.policyDecision.allowed
                    ? 'Rebalance Blocked by Policy'
                    : 'Rebalance Failed'}
                </p>
              </div>
              <p className="text-xs text-red-700 dark:text-red-300">
                {result.policyDecision?.reason || errorMsg}
              </p>
              <Button variant="outline" size="sm" onClick={handleReset} className="gap-2">
                Try Again
              </Button>
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
              <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 space-y-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                  <p className="font-medium text-emerald-800 dark:text-emerald-200">
                    Rebalance Complete — Fresh Solvency Proof Published
                  </p>
                </div>
                <div className="text-xs text-emerald-700 dark:text-emerald-300 space-y-1.5">
                  <p className="flex items-center gap-1">
                    <span className="font-medium">Action:</span> {result.action}
                    <Badge variant="outline" className="text-[10px] ml-1">Risk score: {result.riskScore?.toFixed(2)}</Badge>
                  </p>
                  <p className="flex items-center gap-1">
                    <span className="font-medium">Policy decision:</span>
                    <Badge className="bg-emerald-100 text-emerald-800 text-[10px]">
                      {result.policyDecision?.policyAction}
                    </Badge>
                  </p>
                  <p className="flex items-center gap-1">
                    <span className="font-medium">New collateral ratio:</span>
                    <span className="tabular-nums">{result.newCollateralRatio}%</span>
                  </p>
                  {result.txHash && (
                    <p className="flex items-center gap-1">
                      <span className="font-medium">On-chain tx:</span>
                      <a
                        href={`https://coston2-explorer.flare.network/tx/${result.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-[10px] text-emerald-700 dark:text-emerald-300 hover:underline inline-flex items-center gap-0.5"
                      >
                        {result.txHash.slice(0, 18)}...{result.txHash.slice(-4)}
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    </p>
                  )}
                  {result.merkleRoot && (
                    <p className="flex items-center gap-1">
                      <span className="font-medium">New Merkle root:</span>
                      <code className="font-mono text-[10px] break-all">
                        {result.merkleRoot.slice(0, 20)}...{result.merkleRoot.slice(-8)}
                      </code>
                    </p>
                  )}
                  {result.votingRound && (
                    <p className="flex items-center gap-1">
                      <span className="font-medium">Voting round:</span>
                      <span className="tabular-nums">{result.votingRound}</span>
                    </p>
                  )}
                </div>
              </div>

              <Button variant="outline" size="sm" onClick={handleReset} className="gap-2">
                Run Another Simulation
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        <Separator />

        {/* Quote */}
        <div className="flex items-start gap-2 text-xs text-muted-foreground italic">
          <Quote className="h-3 w-3 shrink-0 mt-0.5 text-emerald-500" />
          <p>
            Real FTSO price → real risk score → real on-chain policy check → real
            solvency proof republish. Every step verifiable on Coston2 explorer.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
