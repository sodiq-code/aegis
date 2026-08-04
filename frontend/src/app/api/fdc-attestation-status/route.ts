/**
 * API Route: FDC Attestation Status
 *
 * Reads FDC (Flare Data Connector) attestation infrastructure status from Coston2:
 *   - Current voting round from FlareSystemsManager
 *   - Merkle root for the current voting round from FdcVerification
 *   - FDC Hub and Verification contract addresses
 *
 * This enables the auditor to see the attestation infrastructure state
 * and understand when/where solvency proofs are anchored.
 *
 */

import { NextResponse } from 'next/server';
import { getFlareConfig, AEGIS_CONTRACTS, FLARE_SYSTEM_CONTRACTS } from '@/lib/flare-config';

interface JsonRpcResponse {
  result?: string;
  error?: { code: number; message: string };
}

async function rpcCall(method: string, params: unknown[] = []): Promise<string> {
  const config = getFlareConfig();
  const response = await fetch(config.rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const data: JsonRpcResponse = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.result || '0x0';
}

async function safeEthCall(to: string, data: string): Promise<string | null> {
  try {
    const result = await rpcCall('eth_call', [{ to, data }, 'latest']);
    if (result && result !== '0x' && result !== '0x0' && result.length > 10) {
      return result;
    }
    return null;
  } catch {
    return null;
  }
}

async function isContractDeployed(address: string): Promise<boolean> {
  const code = await rpcCall('eth_getCode', [address, 'latest']);
  return code.length > 10;
}

export async function GET() {
  try {
    // Read current voting round from FlareSystemsManager
    let currentVotingRound = 0;
    try {
      // getCurrentVotingEpochId() — function selector from Flare contract
      const result = await safeEthCall(
        FLARE_SYSTEM_CONTRACTS.FlareSystemsManager,
        '0x4134520b' // getCurrentVotingEpochId()
      );
      if (result) {
        currentVotingRound = parseInt(result.slice(2, 66), 16);
      }
    } catch {}

    // Read Merkle root from FdcVerification for current voting round
    let merkleRoot = '';
    if (currentVotingRound > 0) {
      try {
        const roundHex = currentVotingRound.toString(16).padStart(64, '0');
        const result = await safeEthCall(
          FLARE_SYSTEM_CONTRACTS.FdcVerification,
          '0x3c70b357' + roundHex // merkleRoot(uint256)
        );
        if (result) merkleRoot = result;
      } catch {}
    }

    // Check if FDC contracts are deployed
    const [fdcHubDeployed, fdcVerificationDeployed, fdcAttestorDeployed] = await Promise.all([
      isContractDeployed(FLARE_SYSTEM_CONTRACTS.FdcHub),
      isContractDeployed(FLARE_SYSTEM_CONTRACTS.FdcVerification),
      isContractDeployed(AEGIS_CONTRACTS.FDCAttestor),
    ]);

    // Read current voting round from FDCAttestor (if deployed)
    let attestorVotingRound = 0;
    if (fdcAttestorDeployed) {
      try {
        const result = await safeEthCall(
          AEGIS_CONTRACTS.FDCAttestor,
          '0x4134520b' // getCurrentVotingRound()
        );
        if (result) attestorVotingRound = parseInt(result.slice(2, 66), 16);
      } catch {}
    }

    // Also check Fdc2 contracts (FDC V2)
    const [fdc2HubDeployed, fdc2VerificationDeployed] = await Promise.all([
      isContractDeployed(FLARE_SYSTEM_CONTRACTS.Fdc2Hub).catch(() => false),
      isContractDeployed(FLARE_SYSTEM_CONTRACTS.Fdc2Verification).catch(() => false),
    ]);

    return NextResponse.json({
      currentVotingRound,
      merkleRoot,
      attestorVotingRound,
      contractsDeployed: {
        FdcHub: fdcHubDeployed,
        FdcVerification: fdcVerificationDeployed,
        FDCAttestor: fdcAttestorDeployed,
        Fdc2Hub: fdc2HubDeployed,
        Fdc2Verification: fdc2VerificationDeployed,
      },
      fdcHubAddress: FLARE_SYSTEM_CONTRACTS.FdcHub,
      fdcVerificationAddress: FLARE_SYSTEM_CONTRACTS.FdcVerification,
      fdcAttestorAddress: AEGIS_CONTRACTS.FDCAttestor,
      fdc2HubAddress: FLARE_SYSTEM_CONTRACTS.Fdc2Hub,
      fdc2VerificationAddress: FLARE_SYSTEM_CONTRACTS.Fdc2Verification,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to read FDC attestation status',
        currentVotingRound: 0,
        merkleRoot: '',
        contractsDeployed: {},
      },
      { status: 503 }
    );
  }
}
