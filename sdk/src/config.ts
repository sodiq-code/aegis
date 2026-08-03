/**
 * Aegis SDK — Configuration
 *
 * Network configs, contract addresses, and system contract addresses
 * for connecting to the Aegis protocol on Flare (Coston2 testnet).
 */

/** Flare network configuration */
export interface FlareNetworkConfig {
  chainId: number;
  chainIdHex: string;
  name: string;
  rpcUrl: string;
  blockExplorer: string;
  currency: { name: string; symbol: string; decimals: number };
}

/** Aegis contract addresses */
export interface AegisContractAddresses {
  VaultCore: string;
  VerifierRole: string;
  PolicyRegistry: string;
  SolvencyRoot: string;
  InstructionSender: string;
  FDCAttestor: string;
  PMWInstructionRelay: string;
}

/** Flare system contract addresses */
export interface FlareSystemContractAddresses {
  FtsoV2: string;
  FdcHub: string;
  FdcVerification: string;
  FdcRequestFeeConfigs: string;
  FlareSystemsManager: string;
  FlareTeeManager: string;
  Fdc2Hub: string;
  Fdc2Verification: string;
}

/** FCC Extension proxy configuration */
export interface FccExtensionConfig {
  proxyUrl: string;
  timeout: number;
}

/** Full Aegis SDK configuration */
export interface AegisSdkConfig {
  rpcUrl?: string;
  network?: 'coston2' | 'songbird';
  contracts?: Partial<AegisContractAddresses>;
  systemContracts?: Partial<FlareSystemContractAddresses>;
  fccProxyUrl?: string;
  fccTimeout?: number;
  /** Custom fetch — allows usage in Node.js, browsers, or test environments */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

// --- Network Configs ---

const COSTON2: FlareNetworkConfig = {
  chainId: 114,
  chainIdHex: '0x72',
  name: 'Coston2',
  rpcUrl: 'https://coston2-api.flare.network/ext/C/rpc',
  blockExplorer: 'https://coston2-explorer.flare.network',
  currency: { name: 'CFLR', symbol: 'CFLR', decimals: 18 },
};

const SONGBIRD: FlareNetworkConfig = {
  chainId: 14,
  chainIdHex: '0xe',
  name: 'Songbird',
  rpcUrl: 'https://songbird-api.flare.network/ext/C/rpc',
  blockExplorer: 'https://songbird-explorer.flare.network',
  currency: { name: 'SGB', symbol: 'SGB', decimals: 18 },
};

export const NETWORKS: Record<string, FlareNetworkConfig> = {
  coston2: COSTON2,
  songbird: SONGBIRD,
};

// --- Deployed Contract Addresses (Coston2) ---

export const DEFAULT_AEGIS_CONTRACTS: AegisContractAddresses = {
  VaultCore: '0xcb08be1cc86d3f94c54c64682372e32f669134bc',
  VerifierRole: '0xb513516d02d88be754c5204e132defbb0f4156e6',
  PolicyRegistry: '0xe3fd8668bd865f53c462abc02fe6c6c4397e8cf5',
  SolvencyRoot: '0xf52c1fd632d853ee46a48a82064d3f5d390f057d',
  InstructionSender: '0xb175f16e1cea66360e354db4b178c04c69363c06',
  FDCAttestor: '0x266a9537eaa76264c926541a77c2705f659ba4f1',
  PMWInstructionRelay: '0xce23e1a26c41eaa305f69d9150d9ac82d8b30743',
};

export const DEFAULT_FLARE_SYSTEM_CONTRACTS: FlareSystemContractAddresses = {
  FtsoV2: '0xC4e9c78EA53db782E28f28Fdf80BaF59336B304d',
  FdcHub: '0x48aC463d7975828989331F4De43341627b9c5f1D',
  FdcVerification: '0x906507E0B64bcD494Db73bd0459d1C667e14B933',
  FdcRequestFeeConfigs: '0x191a1282Ac700edE65c5B0AaF313BAcC3eA7fC7e',
  FlareSystemsManager: '0xA90Db6D10F856799b10ef2A77EBCbF460aC71e52',
  FlareTeeManager: '0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE',
  Fdc2Hub: '0x04dd3Ba33aC798d400bEc42A26F82f9812A421dc',
  Fdc2Verification: '0xA34Ff9be42b2C7782786270a51d33b1baC0462Cd',
};

// --- FTSO Feed IDs ---

export const FTSO_FEEDS = {
  XRP_USD: '0x015852502f555344000000000000000000000000000000000000000000000000',
  FLR_USD: '0x01464c522f55534400000000000000000000000000000000',
} as const;

/**
 * Resolved (full) configuration used internally by SDK clients
 */
export interface ResolvedConfig {
  network: FlareNetworkConfig;
  rpcUrl: string;
  contracts: AegisContractAddresses;
  systemContracts: FlareSystemContractAddresses;
  fccExtension: FccExtensionConfig;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
}

/**
 * Resolve a partial AegisSdkConfig into a full ResolvedConfig
 */
export function resolveConfig(config: AegisSdkConfig = {}): ResolvedConfig {
  const networkName = config.network || 'coston2';
  const network = NETWORKS[networkName] || COSTON2;
  const rpcUrl = config.rpcUrl || network.rpcUrl;
  const contracts = { ...DEFAULT_AEGIS_CONTRACTS, ...config.contracts };
  const systemContracts = { ...DEFAULT_FLARE_SYSTEM_CONTRACTS, ...config.systemContracts };
  const fccExtension: FccExtensionConfig = {
    proxyUrl: config.fccProxyUrl || 'http://localhost:8080',
    timeout: config.fccTimeout || 30000,
  };
  // Use provided fetch or globalThis.fetch
  const fetchFn = config.fetch || (typeof globalThis !== 'undefined' ? globalThis.fetch : undefined!);
  if (!fetchFn) {
    throw new Error('No fetch implementation available. Provide one via config.fetch or use a Node.js >= 18 environment.');
  }

  return { network, rpcUrl, contracts, systemContracts, fccExtension, fetch: fetchFn };
}
