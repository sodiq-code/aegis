/**
 * Aegis Flare Configuration
 * 
 * Connects to Flare RPC (Coston2 testnet) and the Aegis FCC extension proxy.
 * The dashboard is a thin client — all state comes from on-chain contracts
 * and the FCC extension (TEE).
 */

export const FLARE_CONFIG = {
  // Coston2 testnet (chain ID 114)
  coston2: {
    chainId: 114,
    chainIdHex: '0x72',
    name: 'Coston2',
    rpcUrl: 'https://coston2-api.flare.network/ext/C/rpc',
    blockExplorer: 'https://coston2-explorer.flare.network',
    currency: {
      name: 'CFLR',
      symbol: 'CFLR',
      decimals: 18,
    },
  },
  // Songbird (chain ID 14) — for future deployment
  songbird: {
    chainId: 14,
    chainIdHex: '0xe',
    name: 'Songbird',
    rpcUrl: 'https://songbird-api.flare.network/ext/C/rpc',
    blockExplorer: 'https://songbird-explorer.flare.network',
    currency: {
      name: 'SGB',
      symbol: 'SGB',
      decimals: 18,
    },
  },
} as const;

export type FlareNetwork = keyof typeof FLARE_CONFIG;

// Default to Coston2 for development and demo
export const DEFAULT_NETWORK: FlareNetwork = 'coston2';

export const getFlareConfig = (network: FlareNetwork = DEFAULT_NETWORK) => FLARE_CONFIG[network];

/**
 * Aegis Contract Addresses (Coston2)
 */
export const AEGIS_CONTRACTS = {
  VaultCore: '0xcb08be1cc86d3f94c54c64682372e32f669134bc',
  VerifierRole: '0xb513516d02d88be754c5204e132defbb0f4156e6',
  PolicyRegistry: '0xe3fd8668bd865f53c462abc02fe6c6c4397e8cf5',
  SolvencyRoot: '0xf52c1fd632d853ee46a48a82064d3f5d390f057d',
  InstructionSender: '0xb175f16e1cea66360e354db4b178c04c69363c06',
  FDCAttestor: '0x266a9537eaa76264c926541a77c2705f659ba4f1',
  PMWInstructionRelay: '0xce23e1a26c41eaa305f69d9150d9ac82d8b30743',
} as const;

/**
 * Flare System Contract Addresses (Coston2)
 */
export const FLARE_SYSTEM_CONTRACTS = {
  // FAssets (FXRP) on Coston2 — discovered via VaultCore.config()
  AssetManagerFXRP: '0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA',
  FXRP: '0x0b6A3645c240605887a5532109323A3E12273dc7',
  FtsoV2: '0xC4e9c78EA53db782E28f28Fdf80BaF59336B304d',
  FdcHub: '0x48aC463d7975828989331F4De43341627b9c5f1D',
  FdcVerification: '0x906507E0B64bcD494Db73bd0459d1C667e14B933',
  FdcRequestFeeConfigs: '0x191a1282Ac700edE65c5B0AaF313BAcC3eA7fC7e',
  FlareSystemsManager: '0xA90Db6D10F856799b10ef2A77EBCbF460aC71e52',
  FlareTeeManager: '0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE',
  Fdc2Hub: '0x04dd3Ba33aC798d400bEc42A26F82f9812A421dc',
  Fdc2Verification: '0xA34Ff9be42b2C7782786270a51d33b1baC0462Cd',
  FlareContractRegistry: '0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019',
} as const;

/**
 * FCC Extension Proxy Configuration
 * The dashboard connects to the FCC extension proxy for attestation retrieval.
 * In production, this is a TEE-hosted service; for development, it connects
 * to the local extension server.
 */
export const FCC_EXTENSION_CONFIG = {
  // The FCC extension proxy URL (for attestation retrieval)
  proxyUrl: process.env.NEXT_PUBLIC_FCC_PROXY_URL || 'http://localhost:8080',
  // The attestation endpoint
  attestationEndpoint: '/api/attestation',
  // The position endpoint
  positionEndpoint: '/api/position',
  // The risk agent endpoint
  riskAgentEndpoint: '/api/risk',
  // The solvency endpoint
  solvencyEndpoint: '/api/solvency',
  // Timeout in milliseconds
  timeout: 30000,
} as const;

/**
 * FTSO V2 Feed IDs
 */
export const FTSO_FEEDS = {
  XRP_USD: '0x015852502f555344000000000000000000000000000000000000000000000000',
  FLR_USD: '0x01464c522f55534400000000000000000000000000000000',
} as const;
