/**
 * Block Explorer Link
 * 
 * Renders a clickable link to the Coston2 block explorer
 * for contract addresses, transaction hashes, and block numbers.
 */

'use client';

import { FLARE_CONFIG } from '@/lib/flare-config';

interface BlockExplorerLinkProps {
  type: 'address' | 'tx' | 'block';
  value: string;
  label?: string;
  className?: string;
  truncate?: boolean;
}

export function BlockExplorerLink({
  type,
  value,
  label,
  className = '',
  truncate = true,
}: BlockExplorerLinkProps) {
  // Don't render a link if value is empty or invalid
  if (!value || (type !== 'block' && value.length < 10)) {
    return (
      <span className={`text-muted-foreground font-mono text-xs ${className}`}>
        {label || 'N/A'}
      </span>
    );
  }

  const explorerUrl = FLARE_CONFIG.coston2.blockExplorer;
  
  // Blockscout explorer URL paths:
  // /tx/{hash} for transactions
  // /address/{address} for addresses  
  // /block/{number} for blocks (singular, not /blocks/)
  let url: string;
  let displayValue: string;
  
  if (type === 'block') {
    url = `${explorerUrl}/block/${value}`;
    displayValue = label || `#${parseInt(value).toLocaleString()}`;
  } else {
    url = `${explorerUrl}/${type}/${value}`;
    displayValue = label || (truncate && value.length > 10
      ? `${value.slice(0, 6)}...${value.slice(-4)}`
      : value);
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 underline decoration-dotted underline-offset-2 hover:decoration-solid transition-colors font-mono text-xs ${className}`}
      title={type === 'block' ? `Block ${value}` : value}
    >
      {displayValue}
    </a>
  );
}

/**
 * Shorten an Ethereum address for display
 */
export function shortenAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 2) return address;
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}
