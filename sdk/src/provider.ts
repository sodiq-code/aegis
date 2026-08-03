/**
 * Aegis SDK — JSON-RPC Provider
 *
 * Low-level JSON-RPC connection to a Flare EVM-compatible chain.
 * Used internally by VaultClient, PolicyClient, and AuditClient.
 */

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export class JsonRpcProvider {
  private rpcUrl: string;
  private nextId = 1;
  private fetchFn: (input: string, init?: RequestInit) => Promise<Response>;

  constructor(
    rpcUrl: string,
    fetchFn: (input: string, init?: RequestInit) => Promise<Response>
  ) {
    this.rpcUrl = rpcUrl;
    this.fetchFn = fetchFn;
  }

  /** Make a raw JSON-RPC call */
  async call<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    const response = await this.fetchFn(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method, params }),
    });

    if (!response.ok) {
      throw new Error(`Aegis RPC: HTTP ${response.status} from ${this.rpcUrl}`);
    }

    const data = await response.json() as {
      jsonrpc: '2.0';
      id: number;
      result?: T;
      error?: JsonRpcError;
    };

    if (data.error) {
      throw new Error(`Aegis RPC: ${data.error.code} - ${data.error.message}`);
    }
    if (data.result === undefined) {
      throw new Error('Aegis RPC: no result');
    }
    return data.result;
  }

  /** Get chain ID */
  async getChainId(): Promise<number> {
    return parseInt(await this.call<string>('eth_chainId'), 16);
  }

  /** Get latest block number */
  async getBlockNumber(): Promise<number> {
    return parseInt(await this.call<string>('eth_blockNumber'), 16);
  }

  /** Get account balance */
  async getBalance(address: string): Promise<bigint> {
    return BigInt(await this.call<string>('eth_getBalance', [address, 'latest']));
  }

  /** Check if contract deployed at address */
  async isContractDeployed(address: string): Promise<boolean> {
    const code = await this.call<string>('eth_getCode', [address, 'latest']);
    return code.length > 10;
  }

  /** Read-only contract call */
  async ethCall(to: string, data: string): Promise<string> {
    return this.call<string>('eth_call', [{ to, data }, 'latest']);
  }

  /** Get logs (events) */
  async getLogs(filter: {
    address?: string;
    topics?: (string | string[] | null)[];
    fromBlock?: string;
    toBlock?: string;
  }): Promise<unknown[]> {
    return this.call('eth_getLogs', [filter]);
  }

  /** Get the RPC URL */
  getUrl(): string {
    return this.rpcUrl;
  }
}
