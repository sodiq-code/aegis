/**
 * Aegis Dashboard Sidebar
 * 
 * Navigation between Treasury, Policy, and Audit views.
 */

'use client';

import { useWalletStore } from '@/lib/wallet-auth';
import { cn } from '@/lib/utils';
import { Landmark, Shield, FileCheck, Activity, Settings } from 'lucide-react';

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
        <div className="space-y-1">
          {navItems.map(({ view, label, icon: Icon, roles: allowedRoles, description }) => {
            const isAllowed = !isConnected || allowedRoles.includes(role);
            const isActive = activeView === view;

            return (
              <button
                key={view}
                onClick={() => isAllowed && onViewChange(view)}
                disabled={!isAllowed}
                className={cn(
                  'w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all',
                  isActive
                    ? 'bg-emerald-50 text-emerald-900 font-medium dark:bg-emerald-950 dark:text-emerald-100'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  !isAllowed && 'opacity-40 cursor-not-allowed'
                )}
              >
                <Icon className={cn('h-5 w-5', isActive && 'text-emerald-600')} />
                <div className="text-left">
                  <div>{label}</div>
                  <div className="text-xs text-muted-foreground">{description}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Connection Status */}
      <div className="p-3 border-t">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Activity className={cn('h-3 w-3', isConnected ? 'text-emerald-500' : 'text-red-500')} />
          {isConnected ? 'Connected to Flare' : 'Not connected'}
        </div>
      </div>
    </aside>
  );
}
