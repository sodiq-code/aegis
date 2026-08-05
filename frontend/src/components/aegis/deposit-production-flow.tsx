/**
 * Deposit Production Flow Component
 *
 * Real production deposit flow: XRPL → FAssets → VaultCore
 *
 * Steps:
 *   1. Connect Xaman wallet (QR code or manual address entry)
 *   2. Connect MetaMask (EVM) — needed for FXRP recipient
 *   3. Send XRPL payment to FAssets Core Vault (via Xaman deep link or manually)
 *   4. Paste XRPL tx hash
 *   5. POST /api/fassets-mint → initiates FDC attestation + executeDirectMinting
 *   6. Poll GET /api/fassets-mint?sessionId=X for status (~2-4 minutes)
 *   7. Sign approve(VaultCore, amount) via MetaMask
 *   8. Sign depositFXRP(amount, policyId) via MetaMask
 *   9. Done — TEE daemon picks up DepositMade event and republishes solvency root
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
import { useXamanConnection } from '@/lib/xaman-wallet';
import {
  Wallet, Loader2, CheckCircle2, ShieldCheck, XCircle,
  AlertCircle, ExternalLink, QrCode, Link2,
  Zap, Clock, ArrowRight, Fuel, Copy, Check, Smartphone, Info,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

type ProdStep =
  | 'xrpl-connect'
  | 'xrpl-payment'
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
  xrplTestnet: { wsUrl: string; rpcUrl: string; explorer: string };
  timing: { roundDurationSec: number; expectedFinalizationSec: number };
}

interface MintSession {
  sessionId: string;
  step: string;
  votingRound?: number;
  fdcRequestTxHash?: string;
  mintTxHash?: string;
  fxrpMinted?: string;
  error?: string;
  elapsedSec?: number;
}

// User's known XRP testnet wallet (pre-filled as a convenience default)
const DEFAULT_XRPL_WALLET = 'r3RRc87FzPBvJD91Y3F41ZgrwAkZzKhm1o';

const MINT_STEP_LABELS: Record<string, { label: string; description: string }> = {
  initiated:              { label: 'Initiated',              description: 'Mint flow started' },
  verifying_xrpl:         { label: 'Verifying XRPL payment', description: 'Checking XRPL testnet for the payment' },
  requesting_fdc:         { label: 'Requesting FDC attestation', description: 'Preparing attestation request via verifier API' },
  waiting_finalization:   { label: 'Waiting for FDC finalization', description: '~90-180 seconds for voting round to finalize' },
  fetching_proof:         { label: 'Fetching attestation proof', description: 'Downloading Merkle proof from DA Layer' },
  minting:                { label: 'Minting FXRP',           description: 'Calling AssetManagerFXRP.executeDirectMinting' },
  complete:               { label: 'Minted',                 description: 'FXRP minted to your EVM address' },
  error:                  { label: 'Error',                  description: 'Mint failed' },
};

// ─── Copy hook ────────────────────────────────────────────────────────────
function useCopyToClipboard() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback((text: string, id: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    }).catch(() => {
      // fallback
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
  const xaman = useXamanConnection();
  const { copied, copy } = useCopyToClipboard();

  const [amountXrp, setAmountXrp] = useState('1');
  const [policyId, setPolicyId] = useState('2');
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [fassetsInfo, setFassetsInfo] = useState<FassetsInfo | null>(null);
  const [xrplTxHash, setXrplTxHash] = useState('');
  const [manualXrplAddress, setManualXrplAddress] = useState(DEFAULT_XRPL_WALLET);
  const [currentStep, setCurrentStep] = useState<ProdStep>('xrpl-connect');
  const [mintSession, setMintSession] = useState<MintSession | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [approveTxHash, setApproveTxHash] = useState('');
  const [depositTxHash, setDepositTxHash] = useState('');
  // The production flow needs BOTH an EVM address (FXRP recipient) and an
  // XRPL address (payment source). The wallet store only holds one at a time,
  // so we capture the EVM address when MetaMask connects and keep it in local
  // state — it survives the subsequent Xaman connection.
  const [evmRecipientAddress, setEvmRecipientAddress] = useState<string>('');
  const [xamanConfigured, setXamanConfigured] = useState<boolean | null>(null);
  const [xamanPayUrl, setXamanPayUrl] = useState<string | null>(null);
  const [buildingPayLink, setBuildingPayLink] = useState(false);
  const [faucetStatus, setFaucetStatus] = useState<string>('');
  const [faucetLoading, setFaucetLoading] = useState(false);

  // Capture the EVM address whenever MetaMask is connected
  useEffect(() => {
    if (evmStatus === 'connected' && evmType === 'evm' && walletAddress) {
      setEvmRecipientAddress(walletAddress);
    }
  }, [evmStatus, evmType, walletAddress]);

  const isEvmConnected = evmStatus === 'connected' && evmType === 'evm' && !!walletAddress;
  const isXrplConnected = xaman.mode === 'connected' && !!xaman.address;
  // isRunning is TRUE only when we're actively minting/approving/depositing.
  // During 'xrpl-payment' step, the user should be able to edit amount + policy.
  const isRunning = ['minting', 'approving', 'depositing'].includes(currentStep);

  // Check if Xaman API key is configured (server-side)
  useEffect(() => {
    fetch('/api/xaman-config')
      .then(r => r.json())
      .then(data => setXamanConfigured(!!data.configured))
      .catch(() => setXamanConfigured(false));
  }, []);

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

  // Poll mint session status
  useEffect(() => {
    if (!mintSession || mintSession.step === 'complete' || mintSession.step === 'error') {
      return;
    }
    const poll = async () => {
      try {
        const resp = await fetch(`/api/fassets-mint?sessionId=${mintSession.sessionId}`);
        if (!resp.ok) return;
        const data: MintSession = await resp.json();
        setMintSession(data);
        if (data.step === 'complete') {
          setCurrentStep('evm-connect');
        } else if (data.step === 'error') {
          setErrorMsg(data.error || 'Mint failed');
          setCurrentStep('error');
        }
      } catch {}
    };
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [mintSession]);

  // Auto-advance to EVM connect when XRPL is connected
  useEffect(() => {
    if (isXrplConnected && currentStep === 'xrpl-connect') {
      setCurrentStep('xrpl-payment');
    }
  }, [isXrplConnected, currentStep]);

  // Build the 32-byte memo hex for the FAssets direct-mint payment
  const buildMemoHex = useCallback((recipientEvmAddress: string): string => {
    if (!fassetsInfo) return '';
    const prefix = fassetsInfo.memoFormat.prefix.startsWith('0x')
      ? fassetsInfo.memoFormat.prefix.slice(2)
      : fassetsInfo.memoFormat.prefix;
    const recipient = recipientEvmAddress.slice(2).toLowerCase();
    const zeros = '00000000';
    return '0x' + prefix + zeros + recipient;
  }, [fassetsInfo]);

  // Compute the gross XRP amount (net + fees)
  const computeGrossXrp = useCallback((netXrp: number): number => {
    if (!fassetsInfo) return netXrp;
    const feeDecimal = fassetsInfo.fees.feePercent / 100;
    const fee = Math.max(netXrp * feeDecimal, fassetsInfo.fees.minimumFeeXrp);
    return netXrp + fee + fassetsInfo.fees.executorFeeXrp;
  }, [fassetsInfo]);

  // Build a Xaman payment deep-link URL (no API key required)
  const handleBuildXamanPayLink = useCallback(async () => {
    if (!fassetsInfo || !evmRecipientAddress || !isXrplConnected) return;
    setBuildingPayLink(true);
    setErrorMsg('');
    try {
      const gross = computeGrossXrp(parseFloat(amountXrp) || 0);
      const amountDrops = String(Math.round(gross * 1_000_000)); // XRP → drops
      const memoHex = buildMemoHex(evmRecipientAddress);
      const resp = await fetch('/api/xaman-payment-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination: fassetsInfo.coreVaultAddress,
          amountDrops,
          memoHex,
        }),
      });
      if (!resp.ok) throw new Error('Failed to build Xaman payment link');
      const data = await resp.json();
      setXamanPayUrl(data.url);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Failed to build Xaman link');
    } finally {
      setBuildingPayLink(false);
    }
  }, [fassetsInfo, evmRecipientAddress, isXrplConnected, amountXrp, computeGrossXrp, buildMemoHex]);

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

  // Initiate the FAssets mint flow
  const handleInitiateMint = useCallback(async () => {
    if (!xrplTxHash || !evmRecipientAddress) {
      setErrorMsg('XRPL tx hash and EVM recipient address are required');
      setCurrentStep('error');
      return;
    }
    setErrorMsg('');
    setCurrentStep('minting');
    try {
      const resp = await fetch('/api/fassets-mint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          xrplTxHash,
          evmAddress: evmRecipientAddress,
          amountXrp,
          policyId: parseInt(policyId, 10),
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to initiate mint');
      }
      const data = await resp.json();
      setMintSession({ sessionId: data.sessionId, step: data.step });
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Mint initiation failed');
      setCurrentStep('error');
    }
  }, [xrplTxHash, evmRecipientAddress, amountXrp, policyId]);

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

      // Check CFLR (gas) balance — user needs gas for approve + deposit
      const cflrResp = await fetch('/api/flare-rpc?method=cflrBalance&address=' + evmRecipientAddress);
      let cflrBal = 0;
      if (cflrResp.ok) {
        const d = await cflrResp.json();
        cflrBal = d.balance || 0;
      }

      // If gas is low, trigger faucet (drips both FXRP + CFLR)
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

      // Step 1: Prepare deposit calldata
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

      // Step 2: Sign approve
      setCurrentStep('approving');
      const approveTx = await sendTx(prep.approve.to, prep.approve.data);
      setApproveTxHash(approveTx);

      // Step 3: Sign depositFXRP
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
  const memoHex = evmRecipientAddress ? buildMemoHex(evmRecipientAddress) : '';
  const amountDrops = Math.round(grossXrp * 1_000_000);

  // Determine why the "Start FAssets Mint" button is disabled
  const mintButtonDisabledReason = (() => {
    if (isRunning) return null; // not disabled
    if (!isXrplConnected) return 'Connect your XRPL wallet in Step 1 first';
    if (!evmRecipientAddress) return 'Connect MetaMask to receive FXRP';
    if (!xrplTxHash) return 'Paste the XRPL transaction hash after sending payment';
    if (xrplTxHash.length !== 64) return `Tx hash must be 64 hex chars (currently ${xrplTxHash.length})`;
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
          Real Xaman → XRPL → FDC attestation → FXRP mint → vault deposit · ~3-5 minutes end-to-end
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Step 1: XRPL Wallet Connection */}
        <div className={`p-4 rounded-lg border-2 transition-colors ${
          currentStep === 'xrpl-connect' ? 'border-purple-400 bg-purple-50 dark:bg-purple-950/30' :
          isXrplConnected ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30' :
          'border-muted opacity-60'
        }`}>
          <div className="flex items-center gap-2 mb-3">
            {isXrplConnected ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            ) : (
              <div className="h-5 w-5 rounded-full border-2 border-purple-400 flex items-center justify-center text-[10px] font-bold text-purple-600">1</div>
            )}
            <h4 className="font-medium text-sm">Step 1: Connect XRPL Wallet (Xaman)</h4>
          </div>

          {!isXrplConnected && (
            <div className="space-y-3">
              {xaman.mode === 'qr' && xaman.session ? (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Scan this QR code with your Xaman app to connect:
                  </p>
                  <div className="flex justify-center p-3 bg-white rounded-lg">
                    <img
                      src={xaman.session.qrUrl}
                      alt="Xaman QR code"
                      className="w-48 h-48"
                    />
                  </div>
                  <Button variant="outline" size="sm" onClick={xaman.disconnect} className="w-full">
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Enter your Xaman XRPL address (starts with <code>r</code>).
                    We&apos;ve pre-filled your testnet wallet for convenience:
                  </p>
                  <div className="flex gap-2">
                    <Input
                      placeholder="r..."
                      value={manualXrplAddress}
                      onChange={(e) => setManualXrplAddress(e.target.value)}
                      className="flex-1 font-mono text-xs"
                    />
                    <Button
                      size="sm"
                      onClick={() => xaman.connectManual(manualXrplAddress)}
                      disabled={!manualXrplAddress}
                      className="gap-1"
                    >
                      <Link2 className="h-4 w-4" /> Connect
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {xamanConfigured === true && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={xaman.connectWithQr}
                        className="gap-2 flex-1"
                      >
                        <QrCode className="h-4 w-4" /> Connect with Xaman QR
                      </Button>
                    )}
                    {xamanConfigured === false && (
                      <div className="text-[10px] text-amber-700 dark:text-amber-300 italic flex items-center gap-1">
                        <Info className="h-3 w-3" />
                        Xaman QR mode requires a server-side API key — using manual entry instead.
                      </div>
                    )}
                  </div>
                  {xaman.error && (
                    <p className="text-xs text-amber-700 dark:text-amber-300">{xaman.error}</p>
                  )}
                  <div className="text-[10px] text-muted-foreground bg-muted/50 p-2 rounded-md">
                    <strong>Don&apos;t have Xaman?</strong> Install it from{' '}
                    <a href="https://xumm.app" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline">xumm.app</a>
                    {' '}or use any XRPL testnet wallet. Get test XRP from{' '}
                    <a href="https://faucet.tequ.dev/" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline">faucet.tequ.dev</a>.
                  </div>
                </div>
              )}
            </div>
          )}

          {isXrplConnected && (
            <div className="text-xs space-y-1">
              <p className="flex items-center gap-1">
                <span className="font-medium">XRPL Address:</span>
                <code className="font-mono">{xaman.address?.slice(0, 12)}...{xaman.address?.slice(-6)}</code>
                <button
                  onClick={() => xaman.address && copy(xaman.address, 'xrpl-addr')}
                  className="text-muted-foreground hover:text-foreground ml-1"
                  title="Copy full address"
                >
                  {copied === 'xrpl-addr' ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                </button>
                <a
                  href={`https://testnet.xrpl.org/accounts/${xaman.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-purple-600 hover:underline inline-flex items-center"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              </p>
            </div>
          )}
        </div>

        {/* Step 2: XRPL Payment + Amount/Policy */}
        <div className={`p-4 rounded-lg border-2 transition-colors ${
          currentStep === 'xrpl-payment' ? 'border-purple-400 bg-purple-50 dark:bg-purple-950/30' :
          isXrplConnected && currentStep !== 'xrpl-connect' ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30' :
          'border-muted opacity-60'
        }`}>
          <div className="flex items-center gap-2 mb-3">
            {currentStep !== 'xrpl-payment' && currentStep !== 'xrpl-connect' && isXrplConnected ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            ) : currentStep === 'xrpl-payment' ? (
              <div className="h-5 w-5 rounded-full border-2 border-purple-400 flex items-center justify-center text-[10px] font-bold text-purple-600">2</div>
            ) : (
              <div className="h-5 w-5 rounded-full border-2 border-muted" />
            )}
            <h4 className="font-medium text-sm">Step 2: Send XRPL Payment to FAssets Core Vault</h4>
          </div>

          {isXrplConnected && (
            <div className="space-y-4">
              {/* MetaMask connection status — required for FXRP recipient */}
              <div className={`p-3 rounded-lg border-2 transition-colors ${
                isEvmConnected
                  ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30'
                  : 'border-amber-300 bg-amber-50 dark:bg-amber-950/30'
              }`}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 text-xs">
                    <Wallet className={`h-4 w-4 ${isEvmConnected ? 'text-emerald-600' : 'text-amber-600'}`} />
                    <span className="font-medium">
                      {isEvmConnected ? 'MetaMask connected (FXRP recipient)' : 'MetaMask required (FXRP recipient)'}
                    </span>
                  </div>
                  {isEvmConnected ? (
                    <div className="flex items-center gap-2 text-xs">
                      <code className="font-mono">{evmRecipientAddress.slice(0, 8)}...{evmRecipientAddress.slice(-4)}</code>
                      <button
                        onClick={() => copy(evmRecipientAddress, 'evm-addr')}
                        className="text-muted-foreground hover:text-foreground"
                        title="Copy EVM address"
                      >
                        {copied === 'evm-addr' ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                      </button>
                      {evmBalance && (
                        <Badge variant="outline" className="text-[10px]">{evmBalance} C2FLR</Badge>
                      )}
                    </div>
                  ) : (
                    <Button size="sm" onClick={connectEvm} className="gap-2">
                      <Wallet className="h-4 w-4" /> Connect MetaMask
                    </Button>
                  )}
                </div>
                {!isEvmConnected && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-2">
                    MetaMask is needed to receive the minted FXRP and to sign the vault deposit.
                    Connect it now or use the button in the top-right corner.
                  </p>
                )}
              </div>

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

              {/* Payment details */}
              {fassetsInfo && (
                <div className="p-3 rounded-lg bg-muted/50 space-y-3 text-xs">
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
                    <div className="flex items-center gap-1">
                      <span className="font-mono">{grossXrp.toFixed(6)} XRP</span>
                      <button
                        onClick={() => copy(grossXrp.toFixed(6), 'gross')}
                        className="text-muted-foreground hover:text-foreground"
                        title="Copy gross amount"
                      >
                        {copied === 'gross' ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Fees:</span>
                    <span className="font-mono">
                      {fassetsInfo.fees.feePercent.toFixed(2)}% + {fassetsInfo.fees.executorFeeXrp} XRP executor
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Amount in drops:</span>
                    <div className="flex items-center gap-1">
                      <span className="font-mono">{amountDrops.toLocaleString()} drops</span>
                      <button
                        onClick={() => copy(String(amountDrops), 'drops')}
                        className="text-muted-foreground hover:text-foreground"
                        title="Copy amount in drops"
                      >
                        {copied === 'drops' ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                      </button>
                    </div>
                  </div>
                  {memoHex && (
                    <div className="space-y-1 pt-2 border-t border-border/50">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Memo (32 bytes, encodes recipient EVM address):</span>
                        <button
                          onClick={() => copy(memoHex, 'memo')}
                          className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[10px]"
                          title="Copy memo"
                        >
                          {copied === 'memo' ? (
                            <><Check className="h-3 w-3 text-emerald-600" /> Copied!</>
                          ) : (
                            <><Copy className="h-3 w-3" /> Copy memo</>
                          )}
                        </button>
                      </div>
                      <code className="font-mono text-[10px] break-all block bg-background/50 p-2 rounded">{memoHex}</code>
                    </div>
                  )}
                </div>
              )}

              {/* Xaman payment deep-link builder */}
              {fassetsInfo && evmRecipientAddress && (
                <div className="p-3 rounded-lg bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 space-y-2">
                  <div className="flex items-center gap-2">
                    <Smartphone className="h-4 w-4 text-purple-600" />
                    <p className="text-xs font-medium text-purple-800 dark:text-purple-200">
                      Option A: Generate Xaman payment link (recommended)
                    </p>
                  </div>
                  <p className="text-[11px] text-purple-700 dark:text-purple-300">
                    Generates a deep link that opens Xaman with destination, amount, and memo pre-filled.
                    Open the link on your phone (where Xaman is installed) or scan the QR code.
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleBuildXamanPayLink}
                      disabled={buildingPayLink}
                      className="gap-2"
                    >
                      {buildingPayLink ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
                      Generate Payment Link
                    </Button>
                    {xamanPayUrl && (
                      <>
                        <Button
                          size="sm"
                          asChild
                          className="gap-2"
                        >
                          <a href={xamanPayUrl} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-4 w-4" /> Open in Xaman
                          </a>
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => copy(xamanPayUrl, 'payurl')}
                          className="gap-2"
                        >
                          {copied === 'payurl' ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                          Copy Link
                        </Button>
                      </>
                    )}
                  </div>
                  {xamanPayUrl && (
                    <div className="pt-2">
                      <div className="bg-white p-3 rounded-md inline-block">
                        <img
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(xamanPayUrl)}`}
                          alt="Xaman payment QR code"
                          className="w-44 h-44"
                        />
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Scan with Xaman app → review → sign
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Manual payment instructions */}
              <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 space-y-2">
                <div className="flex items-center gap-2">
                  <Info className="h-4 w-4 text-blue-600" />
                  <p className="text-xs font-medium text-blue-800 dark:text-blue-200">
                    Option B: Manual payment in Xaman
                  </p>
                </div>
                <ol className="text-[11px] text-blue-700 dark:text-blue-300 space-y-1 list-decimal list-inside">
                  <li>Open the Xaman app on your phone</li>
                  <li>Send a <strong>Payment</strong> to the <strong>Destination</strong> address above</li>
                  <li>Set the amount to the <strong>Gross amount</strong> above (in XRP)</li>
                  <li>Add a <strong>Memo</strong> with the hex string above (use &quot;Send with Memo&quot; or &quot;Advanced send&quot;)</li>
                  <li>Sign the transaction</li>
                  <li>Copy the transaction hash (64 hex chars) and paste it below</li>
                </ol>
              </div>

              {/* XRPL tx hash input */}
              <div className="space-y-2">
                <Label htmlFor="xrpl-tx" className="text-xs">XRPL Transaction Hash (64 hex chars)</Label>
                <Input
                  id="xrpl-tx"
                  placeholder="e.g. E25E5C... (64 hex chars, no 0x prefix)"
                  value={xrplTxHash}
                  onChange={(e) => setXrplTxHash(e.target.value.trim())}
                  disabled={isRunning}
                  className="font-mono text-xs"
                />
                <div className="flex items-center justify-between text-[10px]">
                  <p className="text-muted-foreground">
                    Find the tx hash in Xaman after signing, or on{' '}
                    <a href="https://testnet.xrpl.org" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline">
                      testnet.xrpl.org
                    </a>
                  </p>
                  {xrplTxHash && xrplTxHash.length !== 64 && (
                    <span className="text-amber-600">{xrplTxHash.length}/64 chars</span>
                  )}
                  {xrplTxHash && xrplTxHash.length === 64 && (
                    <span className="text-emerald-600 flex items-center gap-1"><Check className="h-3 w-3" /> Valid length</span>
                  )}
                </div>
              </div>

              {/* Start FAssets Mint button */}
              <Button
                onClick={handleInitiateMint}
                disabled={!!mintButtonDisabledReason}
                className="w-full gap-2 h-11"
                size="lg"
              >
                {isRunning && currentStep === 'minting' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowRight className="h-4 w-4" />
                )}
                {isRunning && currentStep === 'minting' ? 'Minting...' : 'Start FAssets Mint'}
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

              {/* Gas helper */}
              {isEvmConnected && evmBalance && parseFloat(evmBalance) < 0.05 && (
                <div className="p-3 rounded-lg bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 space-y-2">
                  <div className="flex items-center gap-2">
                    <Fuel className="h-4 w-4 text-orange-600" />
                    <p className="text-xs font-medium text-orange-800 dark:text-orange-200">
                      Low C2FLR gas balance ({evmBalance} C2FLR)
                    </p>
                  </div>
                  <p className="text-[11px] text-orange-700 dark:text-orange-300">
                    You need C2FLR (gas) to sign the approve + deposit transactions in Step 4.
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
          )}

          {!isXrplConnected && (
            <p className="text-xs text-muted-foreground italic">
              Connect your XRPL wallet in Step 1 to continue.
            </p>
          )}
        </div>

        {/* Step 3: FAssets Mint Progress */}
        {(mintSession || currentStep === 'minting') && (
          <div className={`p-4 rounded-lg border-2 transition-colors ${
            currentStep === 'minting' ? 'border-purple-400 bg-purple-50 dark:bg-purple-950/30' :
            mintSession?.step === 'complete' ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30' :
            mintSession?.step === 'error' ? 'border-red-300 bg-red-50 dark:bg-red-950/30' :
            'border-muted'
          }`}>
            <div className="flex items-center gap-2 mb-3">
              {mintSession?.step === 'complete' ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              ) : mintSession?.step === 'error' ? (
                <XCircle className="h-5 w-5 text-red-600" />
              ) : (
                <Loader2 className="h-5 w-5 text-purple-600 animate-spin" />
              )}
              <h4 className="font-medium text-sm">Step 3: FAssets Direct-Mint (FDC Attestation)</h4>
              {mintSession?.elapsedSec && (
                <Badge variant="outline" className="ml-auto text-[10px]">
                  <Clock className="h-3 w-3 mr-1" />
                  {Math.floor(mintSession.elapsedSec / 60)}:{(mintSession.elapsedSec % 60).toString().padStart(2, '0')}
                </Badge>
              )}
            </div>

            {mintSession && (
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Current sub-step:</span>
                  <span className="font-medium">
                    {MINT_STEP_LABELS[mintSession.step]?.label || mintSession.step}
                  </span>
                </div>
                <p className="text-muted-foreground">
                  {MINT_STEP_LABELS[mintSession.step]?.description}
                </p>
                {mintSession.votingRound && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Voting round:</span>
                    <code className="font-mono">{mintSession.votingRound}</code>
                  </div>
                )}
                {mintSession.fdcRequestTxHash && (
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground">FDC request tx:</span>
                    <a
                      href={`https://coston2-explorer.flare.network/tx/${mintSession.fdcRequestTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[10px] text-purple-600 hover:underline inline-flex items-center gap-0.5"
                    >
                      {mintSession.fdcRequestTxHash.slice(0, 18)}...<ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>
                )}
                {mintSession.mintTxHash && (
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground">Mint tx:</span>
                    <a
                      href={`https://coston2-explorer.flare.network/tx/${mintSession.mintTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[10px] text-emerald-600 hover:underline inline-flex items-center gap-0.5"
                    >
                      {mintSession.mintTxHash.slice(0, 18)}...<ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>
                )}
                {mintSession.fxrpMinted && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">FXRP minted:</span>
                    <span className="font-mono">{(Number(mintSession.fxrpMinted) / 1e6).toFixed(6)} FXRP</span>
                  </div>
                )}
                {mintSession.error && (
                  <p className="text-red-700 dark:text-red-300 text-xs break-all">{mintSession.error}</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Step 4: EVM Deposit (approve + depositFXRP) */}
        {mintSession?.step === 'complete' && (
          <div className={`p-4 rounded-lg border-2 transition-colors ${
            currentStep === 'approving' || currentStep === 'depositing'
              ? 'border-purple-400 bg-purple-50 dark:bg-purple-950/30' :
            currentStep === 'complete'
              ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30' :
            'border-muted'
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
                {!isEvmConnected ? (
                  <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:bg-amber-800 flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      Connect MetaMask on Coston2 (top-right) to approve + deposit your FXRP.
                      You need C2FLR (gas) — the faucet will drip 0.5 C2FLR automatically when you click below.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 flex items-start gap-2">
                      <Fuel className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
                      <p className="text-xs text-blue-700 dark:text-blue-300">
                        Clicking below will automatically get test FXRP + C2FLR gas (if needed), then sign approve + deposit via MetaMask.
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
                      Approve & Deposit {amountXrp} FXRP
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
                  </>
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
                  setCurrentStep('xrpl-connect');
                  setMintSession(null);
                  setXrplTxHash('');
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
            Real XRPL payment → FDC attestation → FAssets direct-mint → vault deposit.
            The TEE daemon watches VaultCore for DepositMade events and publishes a fresh
            solvency root on-chain within 15 seconds.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
