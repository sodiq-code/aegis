/**
 * Deposit Flow Component
 *
 * Real cross-chain deposit flow:
 *   1. Connect MetaMask on Coston2 (EVM)
 *   2. Faucet drips test FXRP to the user's address (server-side, no signature)
 *   3. User signs FXRP.approve(VaultCore, amount) via MetaMask
 *   4. User signs VaultCore.depositFXRP(amount, policyId) via MetaMask
 *   5. Frontend triggers POST /api/solvency to publish a fresh attestation
 *      that includes the new deposit
 *
 * The XRPL → Flare FAssets path (Xaman signing) is documented in the README
 * as the production flow; for the Coston2 demo we use EVM + FXRP faucet to
 * demonstrate the same vault deposit + attestation loop without requiring
 * an XRPL testnet account.
 *
 * Reference: https://dev.flare.network/fassets/developer-guides/
 */

'use client';

import { useState, useCallback, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { BlockExplorerLink } from '@/components/aegis/block-explorer-link';
import { AEGIS_CONTRACTS } from '@/lib/flare-config';
import { useWalletStore } from '@/lib/wallet-auth';
import {
  Wallet, Loader2, CheckCircle2, ShieldCheck,
  CircleDollarSign, Quote, AlertCircle, ExternalLink, Fuel,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

type DepositStep =
  | 'idle'
  | 'faucet'
  | 'approving'
  | 'depositing'
  | 'attesting'
  | 'complete'
  | 'error';

interface StepInfo {
  step: Exclude<DepositStep, 'idle' | 'error'>;
  label: string;
  description: string;
}

const STEPS: StepInfo[] = [
  { step: 'faucet',     label: 'Acquiring test FXRP',              description: 'Faucet dripping 5 FXRP to your wallet (server-side)' },
  { step: 'approving',  label: 'Approving VaultCore to spend FXRP', description: 'MetaMask signature: FXRP.approve(VaultCore, amount)' },
  { step: 'depositing', label: 'Depositing into Aegis vault',       description: 'MetaMask signature: VaultCore.depositFXRP(amount, policyId)' },
  { step: 'attesting',  label: 'Publishing fresh solvency proof',   description: 'TEE recomputes Merkle root and publishes on-chain' },
];

const STEP_ORDER: DepositStep[] = ['idle', 'faucet', 'approving', 'depositing', 'attesting', 'complete', 'error'];

function getStepIndex(step: DepositStep): number {
  return STEP_ORDER.indexOf(step);
}

interface Policy {
  id: number;
  name: string;
  description: string;
  riskLevel: string;
  isActive: boolean;
  maxDrawdownBps: number;
  maxSingleExposureBps: number;
  hedgeThresholdBps: number;
  maxDepositPerTx: number;
  minCollateralRatio: number;
}

interface DepositResult {
  approveTxHash?: string;
  depositTxHash?: string;
  attestationTxHash?: string;
  newMerkleRoot?: string;
  positionId?: number;
  error?: string;
}

export function DepositFlow() {
  const { status, type, address } = useWalletStore();
  const [amount, setAmount] = useState('1');
  const [policyId, setPolicyId] = useState('2'); // Balanced
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [currentStep, setCurrentStep] = useState<DepositStep>('idle');
  const [result, setResult] = useState<DepositResult>({});
  const [errorMsg, setErrorMsg] = useState('');
  const [fxrpBalance, setFxrpBalance] = useState<number | null>(null);
  const [cflrBalance, setCflrBalance] = useState<number | null>(null);
  const [minDeposit, setMinDeposit] = useState(1);
  const [maxDeposit, setMaxDeposit] = useState(10000);

  const isEvmConnected = status === 'connected' && type === 'evm' && !!address;
  const isRunning = currentStep !== 'idle' && currentStep !== 'complete' && currentStep !== 'error';

  // Load deposit metadata (policies, min/max, faucet balance)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const r = await fetch('/api/deposit');
        if (!r.ok) return;
        const data = await r.json();
        if (!mounted) return;
        if (data.policies?.length) {
          setPolicies(data.policies);
          // Default to Balanced policy (id=2) if present
          const balanced = data.policies.find((p: Policy) => p.name === 'Balanced');
          if (balanced) setPolicyId(String(balanced.id));
        }
        if (data.minDeposit) setMinDeposit(data.minDeposit);
        if (data.maxDeposit) setMaxDeposit(data.maxDeposit);
      } catch {}
    })();
    return () => { mounted = false; };
  }, []);

  // Check FXRP + CFLR balance when EVM address changes
  const refreshFxrpBalance = useCallback(async () => {
    if (!address) return;
    try {
      const [fxrpResp, cflrResp] = await Promise.all([
        fetch('/api/flare-rpc?method=balanceOf&address=' + address),
        fetch('/api/flare-rpc?method=cflrBalance&address=' + address),
      ]);
      if (fxrpResp.ok) {
        const data = await fxrpResp.json();
        if (typeof data.balance === 'number') setFxrpBalance(data.balance);
      }
      if (cflrResp.ok) {
        const data = await cflrResp.json();
        if (typeof data.balance === 'number') setCflrBalance(data.balance);
      }
    } catch {}
  }, [address]);

  useEffect(() => {
    if (isEvmConnected) refreshFxrpBalance();
  }, [isEvmConnected, refreshFxrpBalance]);

  /**
   * Send a MetaMask transaction and wait for it to be mined.
   */
  const sendTx = useCallback(async (to: string, data: string): Promise<string> => {
    if (!window.ethereum) throw new Error('MetaMask not installed');
    const txHash = await window.ethereum.request({
      method: 'eth_sendTransaction',
      params: [{
        from: address,
        to,
        data,
        value: '0x0',
      }],
    }) as string;

    // Poll for receipt
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const receipt = await window.ethereum.request({
        method: 'eth_getTransactionReceipt',
        params: [txHash],
      }) as { status?: string } | null;
      if (receipt) {
        if (receipt.status === '0x1') return txHash;
        throw new Error(`Transaction reverted: ${txHash}`);
      }
    }
    throw new Error(`Transaction not mined after 2 minutes: ${txHash}`);
  }, [address]);

  const handleDeposit = useCallback(async () => {
    setErrorMsg('');
    setResult({});
    setCurrentStep('faucet');

    try {
      if (!isEvmConnected || !address) {
        throw new Error('Connect MetaMask on Coston2 first');
      }

      // Step 1: Faucet — get test FXRP + CFLR (gas) if either is low
      const [balanceResp, cflrResp] = await Promise.all([
        fetch('/api/flare-rpc?method=balanceOf&address=' + address),
        fetch('/api/flare-rpc?method=cflrBalance&address=' + address),
      ]);
      let currentFxrp = 0;
      let currentCflr = 0;
      if (balanceResp.ok) {
        const b = await balanceResp.json();
        currentFxrp = b.balance || 0;
      }
      if (cflrResp.ok) {
        const b = await cflrResp.json();
        currentCflr = b.balance || 0;
      }

      // Drip if FXRP is low OR CFLR (gas) is low (< 0.05 C2FLR)
      if (currentFxrp < parseFloat(amount) || currentCflr < 0.05) {
        const faucetResp = await fetch('/api/faucet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address }),
        });
        if (!faucetResp.ok) {
          const err = await faucetResp.json().catch(() => ({}));
          throw new Error(err.error || 'Faucet failed');
        }
        const faucetData = await faucetResp.json();
        // Wait a moment for balances to update on-chain
        await new Promise(r => setTimeout(r, 2000));
        await refreshFxrpBalance();
        // Re-check CFLR after drip
        if (faucetData.cflrBalance !== undefined) {
          setCflrBalance(faucetData.cflrBalance);
        }
      }

      // Final gas check — if user still has 0 CFLR, we can't submit txs
      const finalCflr = cflrBalance ?? 0;
      if (finalCflr < 0.001) {
        throw new Error(
          'Insufficient C2FLR for gas. The faucet tried to send gas but it may have failed. ' +
          'Get test C2FLR from https://coston2.towolabs.com/faucet or https://faucet.flare.network then try again.'
        );
      }

      // Step 2: Prepare deposit calldata
      const prepResp = await fetch('/api/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, policyId: parseInt(policyId, 10) }),
      });
      if (!prepResp.ok) {
        const err = await prepResp.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to prepare deposit');
      }
      const prep = await prepResp.json();

      // Step 3: Sign approve(VaultCore, amount) via MetaMask
      setCurrentStep('approving');
      const approveTxHash = await sendTx(prep.approve.to, prep.approve.data);
      setResult(r => ({ ...r, approveTxHash }));

      // Step 4: Sign depositFXRP(amount, policyId) via MetaMask
      setCurrentStep('depositing');
      const depositTxHash = await sendTx(prep.deposit.to, prep.deposit.data);
      setResult(r => ({ ...r, depositTxHash }));

      // Step 5: Trigger fresh solvency proof publish
      setCurrentStep('attesting');
      const solvResp = await fetch('/api/solvency', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'requestAttestation' }),
      });
      const solvData = await solvResp.json().catch(() => ({}));
      if (solvData.published) {
        setResult(r => ({
          ...r,
          attestationTxHash: solvData.txHash,
          newMerkleRoot: solvData.merkleRoot,
        }));
      }

      setCurrentStep('complete');
      await refreshFxrpBalance();
    } catch (e) {
      const err = e as { code?: number; message?: string };
      let msg = err.message || 'Deposit failed';
      // MetaMask error code 4001 = user rejected
      if (err.code === 4001) {
        msg = 'Transaction rejected in MetaMask. Please approve the transaction to continue.';
      }
      // MetaMask insufficient funds
      if (msg.includes('insufficient funds') || msg.includes('gas required exceeds allowance')) {
        msg = 'Insufficient C2FLR for gas. Get test C2FLR from https://faucet.flare.network then try again. ' +
              '(The faucet should have dripped 0.5 C2FLR — check your MetaMask balance.)';
      }
      setErrorMsg(msg);
      setCurrentStep('error');
    }
  }, [address, amount, policyId, isEvmConnected, sendTx, refreshFxrpBalance, cflrBalance]);

  const handleReset = useCallback(() => {
    setCurrentStep('idle');
    setResult({});
    setErrorMsg('');
  }, []);

  const currentStepIndex = getStepIndex(currentStep);
  const selectedPolicy = policies.find(p => String(p.id) === policyId);

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <CircleDollarSign className="h-5 w-5 text-emerald-600" />
          Deposit FXRP into Vault
        </CardTitle>
        <CardDescription>
          Real MetaMask-signed deposit on Coston2 · Faucet provides test FXRP · TEE publishes fresh attestation
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Connection warning */}
        {!isEvmConnected && (
          <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Connect MetaMask on Coston2 (top-right) to deposit. The XRPL → FAssets path
              is the production flow; the demo uses EVM + FXRP faucet to demonstrate the
              same vault deposit + attestation loop.
            </p>
          </div>
        )}

        {/* Gas warning — CFLR balance too low */}
        {isEvmConnected && cflrBalance !== null && cflrBalance < 0.05 && (
          <div className="p-3 rounded-lg bg-orange-50 dark:bg-orange-950/50 border border-orange-200 dark:border-orange-800 flex items-start gap-2">
            <Fuel className="h-4 w-4 text-orange-600 shrink-0 mt-0.5" />
            <div className="text-xs text-orange-700 dark:text-orange-300 space-y-1">
              <p className="font-medium">Low gas balance: {cflrBalance.toFixed(4)} C2FLR</p>
              <p>You need C2FLR (native gas) to sign approve + deposit transactions. Click "Get FXRP & Deposit" — the faucet will drip 0.5 C2FLR for gas automatically.</p>
              <p className="text-[10px]">If gas is still 0 after faucet, get C2FLR from <a href="https://faucet.flare.network" target="_blank" rel="noopener noreferrer" className="underline font-medium">faucet.flare.network</a></p>
            </div>
          </div>
        )}

        {/* Amount + Policy Picker */}
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="deposit-amount" className="flex items-center gap-1.5">
              <CircleDollarSign className="h-3.5 w-3.5 text-muted-foreground" />
              Amount (FXRP)
              {fxrpBalance !== null && (
                <span className="text-xs text-muted-foreground ml-auto">
                  FXRP: {fxrpBalance.toFixed(2)} · C2FLR: {cflrBalance !== null ? cflrBalance.toFixed(4) : '...'}
                </span>
              )}
            </Label>
            <Input
              id="deposit-amount"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={isRunning || currentStep === 'complete'}
              placeholder="1"
              className="tabular-nums"
              min={minDeposit}
              max={maxDeposit}
              step="0.001"
            />
            <p className="text-xs text-muted-foreground">
              Min: {minDeposit} FXRP · Max: {maxDeposit} FXRP
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="policy-select" className="flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
              Risk Policy
            </Label>
            <select
              id="policy-select"
              value={policyId}
              onChange={(e) => setPolicyId(e.target.value)}
              disabled={isRunning || policies.length === 0}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              {policies.length === 0 && <option>Loading policies...</option>}
              {policies.map(p => (
                <option key={p.id} value={String(p.id)} disabled={!p.isActive}>
                  {p.name} ({p.riskLevel}) — Max drawdown: {p.maxDrawdownBps / 100}%, Max exposure: {p.maxSingleExposureBps / 100}%
                </option>
              ))}
            </select>
            {selectedPolicy && (
              <p className="text-xs text-muted-foreground">
                {selectedPolicy.description} · Min collateral ratio: {selectedPolicy.minCollateralRatio / 100}%
              </p>
            )}
          </div>

          <Button
            onClick={handleDeposit}
            disabled={isRunning || currentStep === 'complete' || !isEvmConnected || !amount || parseFloat(amount) <= 0 || policies.length === 0}
            className="w-full gap-2 transition-all"
          >
            {isRunning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Wallet className="h-4 w-4" />
            )}
            {isEvmConnected
              ? (fxrpBalance !== null && fxrpBalance >= parseFloat(amount) && cflrBalance !== null && cflrBalance >= 0.05
                  ? 'Deposit FXRP'
                  : 'Get FXRP + Gas & Deposit')
              : 'Connect MetaMask to Deposit'}
          </Button>
        </div>

        {/* Step Progress */}
        <AnimatePresence mode="wait">
          {currentStep !== 'idle' && currentStep !== 'error' && (
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
                      {/* Show tx hash for completed steps */}
                      {stepInfo.step === 'approving' && result.approveTxHash && (
                        <a
                          href={`https://coston2-explorer.flare.network/tx/${result.approveTxHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] font-mono text-emerald-600 hover:underline inline-flex items-center gap-0.5 mt-0.5"
                        >
                          {result.approveTxHash.slice(0, 18)}...<ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      )}
                      {stepInfo.step === 'depositing' && result.depositTxHash && (
                        <a
                          href={`https://coston2-explorer.flare.network/tx/${result.depositTxHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] font-mono text-emerald-600 hover:underline inline-flex items-center gap-0.5 mt-0.5"
                        >
                          {result.depositTxHash.slice(0, 18)}...<ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      )}
                      {stepInfo.step === 'attesting' && result.attestationTxHash && (
                        <a
                          href={`https://coston2-explorer.flare.network/tx/${result.attestationTxHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] font-mono text-emerald-600 hover:underline inline-flex items-center gap-0.5 mt-0.5"
                        >
                          {result.attestationTxHash.slice(0, 18)}...<ExternalLink className="h-2.5 w-2.5" />
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

        {/* Error State */}
        <AnimatePresence>
          {currentStep === 'error' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="p-4 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 space-y-2"
            >
              <div className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-red-600 shrink-0" />
                <p className="font-medium text-red-800 dark:text-red-200">Deposit Failed</p>
              </div>
              <p className="text-xs text-red-700 dark:text-red-300 break-all">{errorMsg}</p>
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
                    Deposit Complete — Vault State Updated
                  </p>
                </div>
                <div className="text-xs text-emerald-700 dark:text-emerald-300 space-y-1.5">
                  <p className="flex items-center gap-1">
                    <span className="font-medium">Amount:</span> {amount} FXRP deposited
                  </p>
                  <p className="flex items-center gap-1">
                    <span className="font-medium">Policy:</span> {selectedPolicy?.name || `#${policyId}`}
                  </p>
                  <p className="flex items-center gap-1">
                    <span className="font-medium">Vault:</span>
                    <BlockExplorerLink type="address" value={AEGIS_CONTRACTS.VaultCore} label="VaultCore" />
                  </p>
                  {result.depositTxHash && (
                    <p className="flex items-center gap-1">
                      <span className="font-medium">Deposit tx:</span>
                      <a
                        href={`https://coston2-explorer.flare.network/tx/${result.depositTxHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-[10px] text-emerald-700 dark:text-emerald-300 hover:underline inline-flex items-center gap-0.5"
                      >
                        {result.depositTxHash.slice(0, 18)}...{result.depositTxHash.slice(-4)}
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    </p>
                  )}
                  {result.attestationTxHash && (
                    <p className="flex items-center gap-1">
                      <span className="font-medium">Solvency proof:</span>
                      <a
                        href={`https://coston2-explorer.flare.network/tx/${result.attestationTxHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-[10px] text-emerald-700 dark:text-emerald-300 hover:underline inline-flex items-center gap-0.5"
                      >
                        {result.attestationTxHash.slice(0, 18)}...{result.attestationTxHash.slice(-4)}
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    </p>
                  )}
                  {result.newMerkleRoot && (
                    <p className="flex items-center gap-1">
                      <span className="font-medium">New Merkle root:</span>
                      <code className="font-mono text-[10px] break-all">
                        {result.newMerkleRoot.slice(0, 20)}...{result.newMerkleRoot.slice(-8)}
                      </code>
                    </p>
                  )}
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
          <p>
            Real wallet signature, real on-chain deposit, real solvency proof republish.
            All flows verifiable on Coston2 explorer.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
