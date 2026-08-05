/**
 * Deposit Production Flow Component
 *
 * Simplified production deposit flow: XRPL → FAssets → VaultCore
 *
 * ARCHITECTURE: Server-assisted auto-send mode.
 * The user only needs MetaMask. The backend handles the XRPL payment
 * using a pre-funded server-side testnet wallet (no Xaman app required).
 *
 * Steps (user perspective):
 *   1. Connect MetaMask on Coston2 (EVM recipient for FXRP)
 *   2. Enter amount + risk policy
 *   3. Click "Start FAssets Mint" — backend does:
 *      a. Sends XRPL payment to FAssets Core Vault (with memo)
 *      b. Verifies the payment on XRPL
 *      c. Requests FDC attestation
 *      d. Waits for voting round finalization (~90-180s)
 *      e. Fetches Merkle proof from DA Layer
 *      f. Calls AssetManagerFXRP.executeDirectMinting
 *   4. Sign approve(VaultCore, amount) via MetaMask
 *   5. Sign depositFXRP(amount, policyId) via MetaMask
 *   6. Done — TEE daemon picks up DepositMade event and republishes solvency root
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
import { useWalletStore } from '@/lib/wallet-auth';
import {
  Wallet, Loader2, CheckCircle2, ShieldCheck, XCircle,
  AlertCircle, ExternalLink, Zap, Clock, ArrowRight, Fuel,
  Copy, Check, Info, Server,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

type ProdStep =
  | 'idle'
  | 'minting'
  | 'evm-connect'
  | 'approving'
  | 'depositing'
  | 'complete'
  | 'error';

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

interface FassetsInfo {
  coreVaultAddress: string;
  fees: {
    minimumFeeXrp: number;
    feePercent: number;
    executorFeeXrp: number;
  };
  memoFormat: {
    prefix: string;
    example: string;
    description: string;
  };
  autoSendAvailable: boolean;
  serverWalletAddress: string | null;
  timing: { roundDurationSec: number; expectedFinalizationSec: number };
}

interface MintState {
  phase: 'initiated' | 'waiting_finalization' | 'complete' | 'error';
  xrplTxHash?: string;
  votingRound?: number;
  abiEncodedRequest?: string;
  fdcRequestTxHash?: string;
  mintTxHash?: string;
  fxrpMinted?: string;
  finalized?: boolean;
  error?: string;
  elapsedSec?: number;
}

const MINT_STEP_LABELS: Record<string, { label: string; description: string }> = {
  initiated:              { label: 'Initiated',                    description: 'Mint flow started' },
  sending_xrpl:           { label: 'Sending XRPL payment',         description: 'Server wallet sending payment to FAssets Core Vault with memo' },
  verifying_xrpl:         { label: 'Verifying XRPL payment',       description: 'Confirming the payment on XRPL testnet' },
  requesting_fdc:         { label: 'Requesting FDC attestation',   description: 'Preparing attestation request via verifier API' },
  waiting_finalization:   { label: 'Waiting for FDC finalization', description: '~2-4 min for next voting round to finalize + proof indexing' },
  fetching_proof:         { label: 'Fetching attestation proof',   description: 'Downloading Merkle proof from DA Layer' },
  minting:                { label: 'Minting FXRP',                 description: 'Calling AssetManagerFXRP.executeDirectMinting' },
  complete:               { label: 'Minted',                       description: 'FXRP minted to your EVM address' },
  error:                  { label: 'Error',                        description: 'Mint failed' },
};

// ─── Copy hook ────────────────────────────────────────────────────────────
function useCopyToClipboard() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback((text: string, id: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    }).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch {}
      document.body.removeChild(ta);
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    });
  }, []);
  return { copied, copy };
}

export function DepositProductionFlow() {
  const { status: evmStatus, type: evmType, address: walletAddress, connectEvm, balance: evmBalance } = useWalletStore();
  const { copied, copy } = useCopyToClipboard();

  const [amountXrp, setAmountXrp] = useState('1');
  const [policyId, setPolicyId] = useState('2');
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [fassetsInfo, setFassetsInfo] = useState<FassetsInfo | null>(null);
  const [currentStep, setCurrentStep] = useState<ProdStep>('idle');
  const [mintState, setMintState] = useState<MintState | null>(null);
  const [mintStartTime, setMintStartTime] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [approveTxHash, setApproveTxHash] = useState('');
  const [depositTxHash, setDepositTxHash] = useState('');
  const [faucetStatus, setFaucetStatus] = useState<string>('');
  const [faucetLoading, setFaucetLoading] = useState(false);

  // Capture the EVM address whenever MetaMask is connected
  const evmRecipientAddress = walletAddress || '';
  const isEvmConnected = evmStatus === 'connected' && evmType === 'evm' && !!walletAddress;
  const isRunning = ['minting', 'approving', 'depositing'].includes(currentStep);

  // Compute elapsed seconds for mint progress
  const elapsedSec = mintStartTime ? Math.floor((Date.now() - mintStartTime) / 1000) : undefined;

  // Load FAssets info + policies on mount
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [fassetsResp, depositResp] = await Promise.all([
          fetch('/api/fassets-mint?info=true'),
          fetch('/api/deposit'),
        ]);
        if (fassetsResp.ok) {
          const info = await fassetsResp.json();
          if (mounted) setFassetsInfo(info);
        }
        if (depositResp.ok) {
          const data = await depositResp.json();
          if (mounted && data.policies?.length) {
            setPolicies(data.policies);
            const balanced = data.policies.find((p: Policy) => p.name === 'Balanced');
            if (balanced) setPolicyId(String(balanced.id));
          }
        }
      } catch {}
    })();
    return () => { mounted = false; };
  }, []);

  // Poll Phase 2 (finalization) every 10s until complete, error, or 5-min timeout.
  // The backend now tries rounds N..N+4 each poll, so 10s gives fast feedback
  // once the FDC proof becomes available in the DA Layer (typically ~90-180s).
  useEffect(() => {
    if (!mintState || mintState.phase !== 'waiting_finalization') return;
    if (!mintState.votingRound || !mintState.abiEncodedRequest) return;

    let cancelled = false;
    const MAX_WAIT_MS = 5 * 60 * 1000; // 5 minutes

    const poll = async () => {
      if (cancelled) return;
      // Timeout guard — don't let the user wait forever
      if (mintStartTime && Date.now() - mintStartTime > MAX_WAIT_MS) {
        setErrorMsg(
          'FDC finalization is taking longer than expected (5 min). This can happen when the Coston2 attestation network is congested. ' +
          'Your XRPL payment was sent and the attestation was submitted — they will finalize eventually. ' +
          'Click "Start FAssets Mint" again to retry the proof lookup (no new XRPL payment needed if you use the same amount).'
        );
        setCurrentStep('error');
        return;
      }
      try {
        const resp = await fetch('/api/fassets-mint', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phase: 'finalize',
            votingRound: mintState.votingRound,
            abiEncodedRequest: mintState.abiEncodedRequest,
          }),
        });
        if (!resp.ok || cancelled) return;
        const data = await resp.json();
        if (cancelled) return;

        if (data.phase === 'complete') {
          setMintState(prev => prev ? {
            ...prev,
            phase: 'complete',
            mintTxHash: data.mintTxHash,
            fxrpMinted: data.fxrpMinted,
          } : prev);
          setCurrentStep('evm-connect');
        } else if (data.phase === 'error') {
          setErrorMsg(data.error || 'Mint failed');
          setCurrentStep('error');
        }
        // else: still waiting_finalization — keep polling
      } catch {}
    };

    const interval = setInterval(poll, 10000);
    // Also poll immediately
    setTimeout(poll, 1500);
    return () => { cancelled = true; clearInterval(interval); };
  }, [mintState?.phase, mintState?.votingRound, mintState?.abiEncodedRequest, mintStartTime]);

  // Compute the gross XRP amount (net + fees)
  const computeGrossXrp = useCallback((netXrp: number): number => {
    if (!fassetsInfo) return netXrp;
    const feeDecimal = fassetsInfo.fees.feePercent / 100;
    const fee = Math.max(netXrp * feeDecimal, fassetsInfo.fees.minimumFeeXrp);
    return netXrp + fee + fassetsInfo.fees.executorFeeXrp;
  }, [fassetsInfo]);

  // Drip test C2FLR + FXRP from our faucet
  const handleGetGas = useCallback(async () => {
    if (!evmRecipientAddress) return;
    setFaucetLoading(true);
    setFaucetStatus('');
    try {
      const resp = await fetch('/api/faucet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: evmRecipientAddress }),
      });
      const data = await resp.json();
      if (resp.ok) {
        setFaucetStatus(`✓ Received ${data.fxrpDriped || 5} FXRP + ${data.cflrDriped || 0.5} C2FLR for gas`);
      } else {
        setFaucetStatus(`✗ ${data.error || 'Faucet failed'}`);
      }
    } catch (e) {
      setFaucetStatus(`✗ ${e instanceof Error ? e.message : 'Network error'}`);
    } finally {
      setFaucetLoading(false);
    }
  }, [evmRecipientAddress]);

  // Initiate the FAssets mint flow (Phase 1: auto-send)
  const handleInitiateMint = useCallback(async () => {
    if (!evmRecipientAddress) {
      setErrorMsg('Connect MetaMask first to receive the minted FXRP');
      setCurrentStep('error');
      return;
    }
    setErrorMsg('');
    setCurrentStep('minting');
    setMintStartTime(Date.now());
    // Show "sending XRPL" sub-step immediately
    setMintState({
      phase: 'initiated',
      xrplTxHash: undefined,
    });
    try {
      const resp = await fetch('/api/fassets-mint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          autoSend: true,
          evmAddress: evmRecipientAddress,
          amountXrp,
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to initiate mint');
      }
      const data = await resp.json();
      // Phase 1 returns { phase: 'waiting_finalization', xrplTxHash, votingRound, abiEncodedRequest, fdcRequestTxHash }
      setMintState({
        phase: data.phase,
        xrplTxHash: data.xrplTxHash,
        votingRound: data.votingRound,
        abiEncodedRequest: data.abiEncodedRequest,
        fdcRequestTxHash: data.fdcRequestTxHash,
      });
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Mint initiation failed');
      setCurrentStep('error');
      setMintState(null);
    }
  }, [evmRecipientAddress, amountXrp]);

  // Send a MetaMask transaction
  const sendTx = useCallback(async (to: string, data: string): Promise<string> => {
    if (!window.ethereum) throw new Error('MetaMask not installed');
    const txHash = await window.ethereum.request({
      method: 'eth_sendTransaction',
      params: [{ from: evmRecipientAddress, to, data, value: '0x0' }],
    }) as string;
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
    throw new Error(`Transaction not mined: ${txHash}`);
  }, [evmRecipientAddress]);

  // Approve + deposit FXRP after mint completes
  const handleApproveAndDeposit = useCallback(async () => {
    setErrorMsg('');
    try {
      if (!isEvmConnected || !evmRecipientAddress) {
        throw new Error('Connect MetaMask on Coston2 first');
      }

      // Check CFLR (gas) balance
      const cflrResp = await fetch('/api/flare-rpc?method=cflrBalance&address=' + evmRecipientAddress);
      let cflrBal = 0;
      if (cflrResp.ok) {
        const d = await cflrResp.json();
        cflrBal = d.balance || 0;
      }

      if (cflrBal < 0.05) {
        const faucetResp = await fetch('/api/faucet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: evmRecipientAddress }),
        });
        if (faucetResp.ok) {
          const faucetData = await faucetResp.json();
          if (faucetData.cflrBalance !== undefined) {
            cflrBal = faucetData.cflrBalance;
          }
          await new Promise(r => setTimeout(r, 2000));
        }
      }

      if (cflrBal < 0.001) {
        throw new Error(
          'Insufficient C2FLR for gas. Get test C2FLR from https://faucet.flare.network then try again.'
        );
      }

      const prepResp = await fetch('/api/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amountXrp, policyId: parseInt(policyId, 10) }),
      });
      if (!prepResp.ok) {
        const err = await prepResp.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to prepare deposit');
      }
      const prep = await prepResp.json();

      setCurrentStep('approving');
      const approveTx = await sendTx(prep.approve.to, prep.approve.data);
      setApproveTxHash(approveTx);

      setCurrentStep('depositing');
      const depTx = await sendTx(prep.deposit.to, prep.deposit.data);
      setDepositTxHash(depTx);

      setCurrentStep('complete');
    } catch (e) {
      const err = e as { code?: number; message?: string };
      let msg = err.message || 'Deposit failed';
      if (err.code === 4001) {
        msg = 'Transaction rejected in MetaMask. Please approve the transaction to continue.';
      }
      if (msg.includes('insufficient funds') || msg.includes('gas required exceeds allowance')) {
        msg = 'Insufficient C2FLR for gas. Get test C2FLR from https://faucet.flare.network then try again.';
      }
      setErrorMsg(msg);
      setCurrentStep('error');
    }
  }, [isEvmConnected, evmRecipientAddress, amountXrp, policyId, sendTx]);

  const grossXrp = computeGrossXrp(parseFloat(amountXrp) || 0);
  const autoSendAvailable = fassetsInfo?.autoSendAvailable ?? false;

  // Determine why the "Start FAssets Mint" button is disabled
  const mintButtonDisabledReason = (() => {
    if (isRunning) return null;
    if (!isEvmConnected) return 'Connect MetaMask to receive FXRP';
    if (!autoSendAvailable) return 'Server auto-send mode unavailable (env var not set)';
    if (!amountXrp || parseFloat(amountXrp) <= 0) return 'Enter a valid XRP amount';
    return null;
  })();

  return (
    <Card className="transition-shadow hover:shadow-md border-purple-200 dark:border-purple-900">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Zap className="h-5 w-5 text-purple-600" />
          Production Deposit: XRPL → FAssets → Vault
        </CardTitle>
        <CardDescription>
          Server-assisted auto-send · ~3-5 minutes end-to-end · No Xaman app required
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">

        {/* Auto-send mode banner */}
        {autoSendAvailable && (
          <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 flex items-start gap-2">
            <Server className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <p className="font-medium text-emerald-800 dark:text-emerald-200">
                Auto-Send Mode Active
              </p>
              <p className="text-emerald-700 dark:text-emerald-300">
                The server will send the XRPL payment to the FAssets Core Vault automatically using a
                pre-funded testnet wallet. You only need MetaMask to receive the minted FXRP.
                {fassetsInfo?.serverWalletAddress && (
                  <> Server wallet: <code className="font-mono text-[10px]">{fassetsInfo.serverWalletAddress.slice(0, 10)}...{fassetsInfo.serverWalletAddress.slice(-6)}</code></>
                )}
              </p>
            </div>
          </div>
        )}

        {/* Step 1: MetaMask Connection */}
        <div className={`p-4 rounded-lg border-2 transition-colors ${
          isEvmConnected ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30' :
          'border-purple-400 bg-purple-50 dark:bg-purple-950/30'
        }`}>
          <div className="flex items-center gap-2 mb-3">
            {isEvmConnected ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            ) : (
              <div className="h-5 w-5 rounded-full border-2 border-purple-400 flex items-center justify-center text-[10px] font-bold text-purple-600">1</div>
            )}
            <h4 className="font-medium text-sm">Step 1: Connect MetaMask (Coston2)</h4>
          </div>

          {isEvmConnected ? (
            <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-emerald-600" />
                <code className="font-mono">{evmRecipientAddress.slice(0, 10)}...{evmRecipientAddress.slice(-6)}</code>
                <button
                  onClick={() => copy(evmRecipientAddress, 'evm-addr')}
                  className="text-muted-foreground hover:text-foreground"
                  title="Copy EVM address"
                >
                  {copied === 'evm-addr' ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                </button>
              </div>
              {evmBalance && (
                <Badge variant="outline" className="text-[10px]">{evmBalance} C2FLR</Badge>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Connect MetaMask on Coston2 testnet. This address will receive the minted FXRP and
                sign the vault deposit.
              </p>
              <Button onClick={connectEvm} className="w-full gap-2">
                <Wallet className="h-4 w-4" /> Connect MetaMask
              </Button>
            </div>
          )}

          {/* Gas warning + faucet */}
          {isEvmConnected && evmBalance && parseFloat(evmBalance) < 0.05 && (
            <div className="mt-3 p-3 rounded-lg bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 space-y-2">
              <div className="flex items-center gap-2">
                <Fuel className="h-4 w-4 text-orange-600" />
                <p className="text-xs font-medium text-orange-800 dark:text-orange-200">
                  Low C2FLR gas balance ({evmBalance} C2FLR)
                </p>
              </div>
              <p className="text-[11px] text-orange-700 dark:text-orange-300">
                You need C2FLR (gas) to sign the approve + deposit transactions in Step 3.
                Our faucet drips 0.5 C2FLR + 5 FXRP for free.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={handleGetGas}
                disabled={faucetLoading}
                className="gap-2"
              >
                {faucetLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fuel className="h-4 w-4" />}
                Get test C2FLR + FXRP
              </Button>
              {faucetStatus && (
                <p className="text-[11px] text-orange-700 dark:text-orange-300">{faucetStatus}</p>
              )}
            </div>
          )}
        </div>

        {/* Step 2: Amount + Start Mint */}
        <div className={`p-4 rounded-lg border-2 transition-colors ${
          currentStep === 'minting' ? 'border-purple-400 bg-purple-50 dark:bg-purple-950/30' :
          mintState?.phase === 'complete' ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30' :
          isEvmConnected ? 'border-purple-400 bg-purple-50 dark:bg-purple-950/30' :
          'border-muted opacity-60'
        }`}>
          <div className="flex items-center gap-2 mb-3">
            {mintState?.phase === 'complete' ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            ) : currentStep === 'minting' ? (
              <Loader2 className="h-5 w-5 text-purple-600 animate-spin" />
            ) : (
              <div className="h-5 w-5 rounded-full border-2 border-purple-400 flex items-center justify-center text-[10px] font-bold text-purple-600">2</div>
            )}
            <h4 className="font-medium text-sm">Step 2: Start FAssets Mint</h4>
          </div>

          {isEvmConnected && (
            <div className="space-y-4">
              {/* Amount + Policy */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="prod-amount" className="text-xs">Amount (XRP)</Label>
                  <Input
                    id="prod-amount"
                    type="number"
                    value={amountXrp}
                    onChange={(e) => setAmountXrp(e.target.value)}
                    disabled={isRunning}
                    placeholder="1"
                    step="0.1"
                    min="0.21"
                  />
                  <p className="text-[10px] text-muted-foreground">Minimum 0.21 XRP (FAssets lot size)</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="prod-policy" className="text-xs">Risk Policy</Label>
                  <select
                    id="prod-policy"
                    value={policyId}
                    onChange={(e) => setPolicyId(e.target.value)}
                    disabled={isRunning || policies.length === 0}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {policies.length === 0 && <option>Loading...</option>}
                    {policies.map(p => (
                      <option key={p.id} value={String(p.id)} disabled={!p.isActive}>
                        {p.name} ({p.riskLevel})
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-muted-foreground">Vault risk configuration</p>
                </div>
              </div>

              {/* Payment details (read-only, computed) */}
              {fassetsInfo && (
                <div className="p-3 rounded-lg bg-muted/50 space-y-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Destination (Core Vault):</span>
                    <div className="flex items-center gap-1">
                      <code className="font-mono text-[11px]">{fassetsInfo.coreVaultAddress.slice(0, 16)}...{fassetsInfo.coreVaultAddress.slice(-6)}</code>
                      <button
                        onClick={() => copy(fassetsInfo.coreVaultAddress, 'dest')}
                        className="text-muted-foreground hover:text-foreground"
                        title="Copy destination address"
                      >
                        {copied === 'dest' ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                      </button>
                      <a
                        href={`https://testnet.xrpl.org/accounts/${fassetsInfo.coreVaultAddress}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-purple-600 hover:underline inline-flex items-center"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Gross amount (incl. fees):</span>
                    <span className="font-mono">{grossXrp.toFixed(6)} XRP</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Fees:</span>
                    <span className="font-mono">
                      {fassetsInfo.fees.feePercent.toFixed(2)}% + {fassetsInfo.fees.executorFeeXrp} XRP executor
                    </span>
                  </div>
                </div>
              )}

              {/* Start button */}
              <Button
                onClick={handleInitiateMint}
                disabled={!!mintButtonDisabledReason}
                className="w-full gap-2 h-11"
                size="lg"
              >
                {isRunning ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowRight className="h-4 w-4" />
                )}
                {isRunning ? 'Minting...' : 'Start FAssets Mint'}
              </Button>

              {/* Show why the button is disabled */}
              {mintButtonDisabledReason && (
                <div className="p-2 rounded-md bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 flex items-start gap-2">
                  <AlertCircle className="h-3 w-3 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-amber-700 dark:text-amber-300">
                    <strong>Button disabled:</strong> {mintButtonDisabledReason}
                  </p>
                </div>
              )}

              {/* What happens next */}
              {!isRunning && (
                <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 space-y-2">
                  <div className="flex items-center gap-2">
                    <Info className="h-4 w-4 text-blue-600" />
                    <p className="text-xs font-medium text-blue-800 dark:text-blue-200">
                      What happens when you click Start?
                    </p>
                  </div>
                  <ol className="text-[11px] text-blue-700 dark:text-blue-300 space-y-1 list-decimal list-inside">
                    <li>Server sends an XRPL payment to the FAssets Core Vault (with memo encoding your EVM address)</li>
                    <li>Server verifies the payment on XRPL testnet</li>
                    <li>Server requests an FDC attestation and submits it to FdcHub</li>
                    <li>Server waits ~2-4 minutes for the next voting round to finalize + proof indexing</li>
                    <li>Server fetches the Merkle proof from the DA Layer</li>
                    <li>Server calls AssetManagerFXRP.executeDirectMinting — FXRP is minted to your address</li>
                    <li>You sign approve + deposit via MetaMask to deposit FXRP into the vault</li>
                  </ol>
                </div>
              )}
            </div>
          )}

          {!isEvmConnected && (
            <p className="text-xs text-muted-foreground italic">
              Connect MetaMask in Step 1 to continue.
            </p>
          )}
        </div>

        {/* Step 3: FAssets Mint Progress */}
        {(mintState || currentStep === 'minting') && (
          <div className={`p-4 rounded-lg border-2 transition-colors ${
            mintState?.phase === 'complete' ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30' :
            mintState?.phase === 'error' ? 'border-red-300 bg-red-50 dark:bg-red-950/30' :
            'border-purple-400 bg-purple-50 dark:bg-purple-950/30'
          }`}>
            <div className="flex items-center gap-2 mb-3">
              {mintState?.phase === 'complete' ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              ) : mintState?.phase === 'error' ? (
                <XCircle className="h-5 w-5 text-red-600" />
              ) : (
                <Loader2 className="h-5 w-5 text-purple-600 animate-spin" />
              )}
              <h4 className="font-medium text-sm">Step 3: FAssets Direct-Mint (FDC Attestation)</h4>
              {elapsedSec !== undefined && mintState?.phase !== 'complete' && (
                <Badge variant="outline" className="ml-auto text-[10px]">
                  <Clock className="h-3 w-3 mr-1" />
                  {Math.floor(elapsedSec / 60)}:{(elapsedSec % 60).toString().padStart(2, '0')}
                </Badge>
              )}
            </div>

            {mintState && (
              <div className="space-y-2 text-xs">
                {/* Derive the current sub-step label from the phase + state */}
                {(() => {
                  let stepKey = 'initiated';
                  if (mintState.phase === 'complete') stepKey = 'complete';
                  else if (mintState.phase === 'error') stepKey = 'error';
                  else if (mintState.phase === 'waiting_finalization') {
                    if (mintState.abiEncodedRequest) stepKey = 'waiting_finalization';
                    else if (mintState.xrplTxHash) stepKey = 'verifying_xrpl';
                    else stepKey = 'sending_xrpl';
                  }
                  const label = MINT_STEP_LABELS[stepKey];
                  return (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Current sub-step:</span>
                        <span className="font-medium">{label?.label || stepKey}</span>
                      </div>
                      <p className="text-muted-foreground">{label?.description}</p>
                    </>
                  );
                })()}
                {mintState.xrplTxHash && (
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground">XRPL payment tx:</span>
                    <a
                      href={`https://testnet.xrpl.org/transactions/${mintState.xrplTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[10px] text-purple-600 hover:underline inline-flex items-center gap-0.5"
                    >
                      {mintState.xrplTxHash.slice(0, 18)}...<ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>
                )}
                {mintState.votingRound && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Voting round:</span>
                    <code className="font-mono">{mintState.votingRound}</code>
                  </div>
                )}
                {mintState.fdcRequestTxHash && (
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground">FDC request tx:</span>
                    <a
                      href={`https://coston2-explorer.flare.network/tx/${mintState.fdcRequestTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[10px] text-purple-600 hover:underline inline-flex items-center gap-0.5"
                    >
                      {mintState.fdcRequestTxHash.slice(0, 18)}...<ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>
                )}
                {mintState.mintTxHash && (
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground">Mint tx:</span>
                    <a
                      href={`https://coston2-explorer.flare.network/tx/${mintState.mintTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[10px] text-emerald-600 hover:underline inline-flex items-center gap-0.5"
                    >
                      {mintState.mintTxHash.slice(0, 18)}...<ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>
                )}
                {mintState.fxrpMinted && (
                  <div className="flex items-center justify-between p-2 rounded bg-emerald-50 dark:bg-emerald-950/50">
                    <span className="text-emerald-700 dark:text-emerald-300 font-medium">FXRP minted to your address:</span>
                    <span className="font-mono font-bold text-emerald-700 dark:text-emerald-300">{(Number(mintState.fxrpMinted) / 1e6).toFixed(6)} FXRP</span>
                  </div>
                )}
                {mintState.error && (
                  <p className="text-red-700 dark:text-red-300 text-xs break-all">{mintState.error}</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Step 4: EVM Deposit (approve + depositFXRP) */}
        {mintState?.phase === 'complete' && (
          <div className={`p-4 rounded-lg border-2 transition-colors ${
            currentStep === 'approving' || currentStep === 'depositing'
              ? 'border-purple-400 bg-purple-50 dark:bg-purple-950/30' :
            currentStep === 'complete'
              ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30' :
            'border-purple-400 bg-purple-50 dark:bg-purple-950/30'
          }`}>
            <div className="flex items-center gap-2 mb-3">
              {currentStep === 'complete' ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              ) : currentStep === 'approving' || currentStep === 'depositing' ? (
                <Loader2 className="h-5 w-5 text-purple-600 animate-spin" />
              ) : (
                <div className="h-5 w-5 rounded-full border-2 border-purple-400 flex items-center justify-center text-[10px] font-bold text-purple-600">4</div>
              )}
              <h4 className="font-medium text-sm">Step 4: Deposit minted FXRP into Vault</h4>
            </div>

            {currentStep !== 'complete' && (
              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 flex items-start gap-2">
                  <Fuel className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
                  <p className="text-xs text-blue-700 dark:text-blue-300">
                    Clicking below will sign approve + deposit via MetaMask. C2FLR gas will be
                    auto-dripped if needed.
                  </p>
                </div>
                <Button
                  onClick={handleApproveAndDeposit}
                  disabled={isRunning}
                  className="w-full gap-2"
                >
                  {isRunning ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Wallet className="h-4 w-4" />
                  )}
                  {currentStep === 'approving' ? 'Approving...' : currentStep === 'depositing' ? 'Depositing...' : `Approve & Deposit ${amountXrp} FXRP`}
                </Button>
                {approveTxHash && (
                  <p className="text-xs flex items-center gap-1">
                    <span className="text-muted-foreground">Approve tx:</span>
                    <a
                      href={`https://coston2-explorer.flare.network/tx/${approveTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[10px] text-emerald-600 hover:underline inline-flex items-center gap-0.5"
                    >
                      {approveTxHash.slice(0, 18)}...<ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </p>
                )}
                {depositTxHash && (
                  <p className="text-xs flex items-center gap-1">
                    <span className="text-muted-foreground">Deposit tx:</span>
                    <a
                      href={`https://coston2-explorer.flare.network/tx/${depositTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[10px] text-emerald-600 hover:underline inline-flex items-center gap-0.5"
                    >
                      {depositTxHash.slice(0, 18)}...<ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </p>
                )}
              </div>
            )}

            {currentStep === 'complete' && (
              <div className="space-y-2 text-xs">
                <p className="flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="h-4 w-4" /> Deposit Complete — Vault State Updated
                </p>
                <p>The TEE daemon will publish a fresh solvency root within 15 seconds.</p>
              </div>
            )}
          </div>
        )}

        {/* Error state */}
        <AnimatePresence>
          {currentStep === 'error' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="p-4 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 space-y-2"
            >
              <div className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-red-600 shrink-0" />
                <p className="font-medium text-red-800 dark:text-red-200">Flow Failed</p>
              </div>
              <p className="text-xs text-red-700 dark:text-red-300 break-all">{errorMsg}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setCurrentStep('idle');
                  setMintState(null);
                  setMintStartTime(null);
                  setApproveTxHash('');
                  setDepositTxHash('');
                  setErrorMsg('');
                }}
                className="gap-2"
              >
                Try Again
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        <Separator />

        {/* Footer info */}
        <div className="flex items-start gap-2 text-xs text-muted-foreground italic">
          <ShieldCheck className="h-3 w-3 shrink-0 mt-0.5 text-purple-500" />
          <p>
            Server-assisted XRPL payment → FDC attestation → FAssets direct-mint → vault deposit.
            The TEE daemon watches VaultCore for DepositMade events and publishes a fresh
            solvency root on-chain within 15 seconds.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
