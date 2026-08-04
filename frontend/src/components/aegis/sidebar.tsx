/**
 * Aegis Dashboard Sidebar
 * 
 * Navigation between Treasury, Policy, and Audit views.
 * Production polish: role gating, tooltips, keyboard navigation, accessibility,
 * on-chain links.
 */

'use client';

import { useWalletStore } from '@/lib/wallet-auth';
import { cn } from '@/lib/utils';
import { FLARE_CONFIG, AEGIS_CONTRACTS } from '@/lib/flare-config';
import { Landmark, Shield, FileCheck, Activity, ExternalLink, Link2 } from 'lucide-react';
import {
  Tooltip as UiTooltip,
  TooltipContent as UiTooltipContent,
  TooltipProvider as UiTooltipProvider,
  TooltipTrigger as UiTooltipTrigger,
} from '@/components/ui/tooltip';
import { BlockExplorerLink } from '@/components/aegis/block-explorer-link';

export type AegisView = 'treasury' | 'policy' | 'audit';

interface SidebarProps {
  activeView: AegisView;
  onViewChange: (view: AegisView) => void;
}

const navItems: Array<{
  view: AegisView;
  label: string;
  icon: React.ElementType;
  roles: Array<'depositor' | 'auditor' | 'admin'>;
  description: string;
}> = [
  {
    view: 'treasury',
    label: 'Treasury',
    icon: Landmark,
    roles: ['depositor', 'auditor', 'admin'],
    description: 'Balances, positions, risk score',
  },
  {
    view: 'policy',
    label: 'Policy',
    icon: Shield,
    roles: ['depositor', 'admin'],
    description: 'Risk parameters & thresholds',
  },
  {
    view: 'audit',
    label: 'Audit',
    icon: FileCheck,
    roles: ['auditor', 'admin'],
    description: 'Solvency proofs & verification',
  },
];

export function AegisSidebar({ activeView, onViewChange }: SidebarProps) {
  const { role, status } = useWalletStore();

  const isConnected = status === 'connected';

  return (
    <aside className="hidden md:flex w-64 flex-col border-r bg-muted/30">
      <div className="flex-1 py-4 px-3">
        <UiTooltipProvider delayDuration={300}>
          <div className="space-y-1">
            {navItems.map(({ view, label, icon: Icon, roles: allowedRoles, description }) => {
              const isAllowed = !isConnected || allowedRoles.includes(role);
              const isActive = activeView === view;

              const button = (
                <button
                  key={view}
                  onClick={() => isAllowed && onViewChange(view)}
                  disabled={!isAllowed}
                  aria-current={isActive ? 'page' : undefined}
                  aria-label={`${label} — ${description}${!isAllowed ? ' (not available for your role)' : ''}`}
                  className={cn(
                    'w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all duration-150',
                    isActive
                      ? 'bg-emerald-50 text-emerald-900 font-medium dark:bg-emerald-950 dark:text-emerald-100 shadow-sm'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    !isAllowed && 'opacity-40 cursor-not-allowed',
                    isAllowed && !isActive && 'hover:translate-x-0.5'
                  )}
                >
                  <Icon className={cn('h-5 w-5 shrink-0', isActive && 'text-emerald-600')} />
                  <div className="text-left">
                    <div>{label}</div>
                    <div className="text-xs text-muted-foreground">{description}</div>
                  </div>
                  {isActive && (
                    <div className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  )}
                </button>
              );

              if (!isAllowed && isConnected) {
                return (
                  <UiTooltip key={view}>
                    <UiTooltipTrigger asChild>{button}</UiTooltipTrigger>
                    <UiTooltipContent side="right">
                      <p className="text-xs">Available for: {allowedRoles.join(', ')}</p>
                    </UiTooltipContent>
                  </UiTooltip>
                );
              }

              return button;
            })}
          </div>
        </UiTooltipProvider>

        {/* On-Chain Contracts */}
        <div className="mt-6 pt-4 border-t">
          <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
            <Link2 className="h-3 w-3" />
            On-Chain Contracts
          </p>
          <div className="space-y-1.5">
            {[
              { name: 'VaultCore', address: AEGIS_CONTRACTS.VaultCore },
              { name: 'SolvencyRoot', address: AEGIS_CONTRACTS.SolvencyRoot },
              { name: 'PolicyRegistry', address: AEGIS_CONTRACTS.PolicyRegistry },
            ].map(({ name, address }) => (
              <div key={name} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{name}</span>
                <BlockExplorerLink type="address" value={address} truncate={true} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Connection Status */}
      <div className="p-3 border-t space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Activity className={cn('h-3 w-3', isConnected ? 'text-emerald-500' : 'text-red-500')} />
          <span>{isConnected ? 'Connected to Flare' : 'Not connected'}</span>
          {isConnected && (
            <span className="ml-auto text-emerald-500">&bull;</span>
          )}
        </div>
        <a
          href={FLARE_CONFIG.coston2.blockExplorer}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 transition-colors"
        >
          <ExternalLink className="h-3 w-3" />
          Coston2 Block Explorer
        </a>
      </div>
    </aside>
  );
}
