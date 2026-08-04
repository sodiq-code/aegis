/**
 * Deposit Flow Component
 *
 * Step-by-step deposit flow for depositing FXRP into the Aegis vault.
 * Simulates XRPL wallet sign-in via Xaman, FXRP minting, vault deposit,
 * and FDC attestation confirming the XRPL payment.
 */

'use client';

import { useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { BlockExplorerLink } from '@/components/aegis/block-explorer-link';
import { AEGIS_CONTRACTS } from '@/lib/flare-config';
import { useWalletStore, useXamanWallet } from '@/lib/wallet-auth';
import {
  Wallet, Loader2, CheckCircle2, ShieldCheck,
  CircleDollarSign, Quote
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

type DepositStep = 'idle' | 'signing' | 'minting' | 'depositing' | 'attesting' | 'complete';

interface StepInfo {
  step: DepositStep;
  label: string;
  description: string;
}

const STEPS: StepInfo[] = [
  { step: 'signing', label: 'Signing XRPL transaction via Xaman', description: 'Requesting wallet signature for XRP payment' },
  { step: 'minting', label: 'Minting FXRP via Flare Smart Accounts', description: 'Wrapping XRP as FXRP on Flare' },
  { step: 'depositing', label: 'Depositing into Aegis vault', description: 'Calling VaultCore.deposit()' },
  { step: 'attesting', label: 'FDC attestation confirming XRPL payment', description: 'Flare Data Connector verifying XRPL proof' },
];

const STEP_ORDER: DepositStep[] = ['idle', 'signing', 'minting', 'depositing', 'attesting', 'complete'];

function getStepIndex(step: DepositStep): number {
  return STEP_ORDER.indexOf(step);
}

// Simulated attestation hash
const SIMULATED_ATTESTATION_HASH = '0x7a3b9c1d5e8f2a4b6c8d0e2f4a6b8c1d3e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3b';

export function DepositFlow() {
  const { status, type } = useWalletStore();
  const { connectXrpl } = useXamanWallet();
  const [amount, setAmount] = useState('1000');
  const [currentStep, setCurrentStep] = useState<DepositStep>('idle');
  const [attestationHash, setAttestationHash] = useState('');

  const isXrplConnected = status === 'connected' && type === 'xrpl';
  const isRunning = currentStep !== 'idle' && currentStep !== 'complete';
  const currentStepIndex = getStepIndex(currentStep);

  const simulateDelay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

  const handleDeposit = useCallback(async () => {
    // If not connected, connect Xaman first
    if (!isXrplConnected) {
      connectXrpl();
      await simulateDelay(800);
    }

    setCurrentStep('signing');

    // Step 1: Signing XRPL transaction
    await simulateDelay(1500);
    setCurrentStep('minting');

    // Step 2: Minting FXRP
    await simulateDelay(1500);
    setCurrentStep('depositing');

    // Step 3: Depositing into vault
    await simulateDelay(1500);
    setCurrentStep('attesting');

    // Step 4: FDC attestation
    await simulateDelay(1500);
    const hash = SIMULATED_ATTESTATION_HASH;
    setAttestationHash(hash);
    setCurrentStep('complete');
  }, [isXrplConnected, connectXrpl]);

  const handleReset = useCallback(() => {
    setCurrentStep('idle');
    setAttestationHash('');
  }, []);

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <CircleDollarSign className="h-5 w-5 text-emerald-600" />
          Deposit FXRP into Vault
        </CardTitle>
        <CardDescription>Cross-chain deposit via XRPL → Flare with FDC attestation</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Amount Input */}
        <div className="space-y-2">
          <Label htmlFor="deposit-amount" className="flex items-center gap-1.5">
            <CircleDollarSign className="h-3.5 w-3.5 text-muted-foreground" />
            Amount (FXRP)
          </Label>
          <div className="flex gap-2">
            <Input
              id="deposit-amount"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={isRunning || currentStep === 'complete'}
              placeholder="1000"
              className="tabular-nums"
              min="1"
            />
            <Button
              onClick={handleDeposit}
              disabled={isRunning || currentStep === 'complete' || !amount || parseFloat(amount) <= 0}
              className="gap-2 shrink-0 transition-all"
            >
              {isRunning ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Wallet className="h-4 w-4" />
              )}
              {isXrplConnected ? 'Deposit' : 'Connect Xaman & Deposit'}
            </Button>
          </div>
        </div>

        {/* Step Progress */}
        <AnimatePresence mode="wait">
          {currentStep !== 'idle' && (
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
                const _isPending = stepIdx > currentStepIndex;

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

              {/* FDC Attestation Hash (shown during attestation step or after) */}
              {(currentStepIndex >= getStepIndex('attesting')) && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="p-3 rounded-lg bg-muted/50 space-y-1"
                >
                  <p className="text-xs font-medium flex items-center gap-1">
                    <ShieldCheck className="h-3 w-3 text-emerald-500" />
                    FDC Attestation Hash
                  </p>
                  <code className="text-[11px] font-mono block break-all text-muted-foreground">
                    {attestationHash || 'Computing...'}
                  </code>
                </motion.div>
              )}
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
                    Deposit Complete — Vault Balance Updated
                  </p>
                </div>
                <div className="text-xs text-emerald-700 dark:text-emerald-300 space-y-1">
                  <p className="flex items-center gap-1">
                    <span className="font-medium">Amount:</span> {amount} FXRP deposited
                  </p>
                  <p className="flex items-center gap-1">
                    <span className="font-medium">Vault:</span>
                    <BlockExplorerLink type="address" value={AEGIS_CONTRACTS.VaultCore} label="VaultCore" />
                  </p>
                  <p className="flex items-center gap-1">
                    <span className="font-medium">Attestation:</span>
                    <code className="font-mono text-[10px]">{attestationHash.slice(0, 18)}...</code>
                  </p>
                </div>
              </div>

              <Button variant="outline" size="sm" onClick={handleReset} className="gap-2">
                Make Another Deposit
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        <Separator />

        {/* Quote */}
        <div className="flex items-start gap-2 text-xs text-muted-foreground italic">
          <Quote className="h-3 w-3 shrink-0 mt-0.5 text-emerald-500" />
          <p>One signature, one on-chain deposit, fully attested.</p>
        </div>
      </CardContent>
    </Card>
  );
}
