/**
 * Aegis Dashboard — Main Page
 * 
 * Institutional Treasury Layer on Flare
 * 
 * Three views: Treasury, Policy, Audit
 * Connected to Flare RPC (Coston2) and FCC extension proxy
 */

'use client';

import { useState } from 'react';
import { AegisNavbar } from '@/components/aegis/navbar';
import { AegisSidebar, AegisView } from '@/components/aegis/sidebar';
import { TreasuryView } from '@/components/aegis/treasury-view';
import { PolicyView } from '@/components/aegis/policy-view';
import { AuditView } from '@/components/aegis/audit-view';
import { useWalletStore } from '@/lib/wallet-auth';
import { Shield, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function AegisDashboard() {
  const [activeView, setActiveView] = useState<AegisView>('treasury');
  const { status } = useWalletStore();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AegisNavbar />

      <div className="flex-1 flex">
        <AegisSidebar activeView={activeView} onViewChange={setActiveView} />

        {/* Mobile Nav */}
        <div className="md:hidden flex border-b overflow-x-auto px-2 py-2 gap-1 w-full">
          {(['treasury', 'policy', 'audit'] as AegisView[]).map((view) => (
            <Button
              key={view}
              variant={activeView === view ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveView(view)}
              className="capitalize"
            >
              {view}
            </Button>
          ))}
        </div>

        {/* Main Content */}
        <main className="flex-1 p-4 md:p-6 overflow-auto">
          {status === 'disconnected' ? (
            <WelcomeScreen onConnect={() => {}} />
          ) : (
            <>
              {activeView === 'treasury' && <TreasuryView />}
              {activeView === 'policy' && <PolicyView />}
              {activeView === 'audit' && <AuditView />}
            </>
          )}
        </main>
      </div>

      {/* Footer */}
      <footer className="border-t py-3 px-4 text-center text-xs text-muted-foreground">
        Aegis — Institutional Treasury Layer on Flare | Coston2 Testnet |{' '}
        <a href="https://dev.flare.network/" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
          Flare Developer Hub
        </a>
      </footer>
    </div>
  );
}

function WelcomeScreen({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-6">
      <Shield className="h-16 w-16 text-emerald-600" />
      <div>
        <h2 className="text-3xl font-bold">Welcome to Aegis</h2>
        <p className="text-muted-foreground mt-2 max-w-md">
          The institutional treasury layer for XRP-native DeFi on Flare.
          Connect your wallet to access the dashboard.
        </p>
      </div>
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Wallet className="h-4 w-4" />
        <span>Connect MetaMask or Xaman to continue</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs text-muted-foreground">
        {[
          { name: 'FAssets (FXRP)', desc: 'Core asset' },
          { name: 'FTSO V2', desc: 'Price feeds' },
          { name: 'FDC', desc: 'Attestations' },
          { name: 'FCC', desc: 'Confidential compute' },
          { name: 'PMW', desc: 'Cross-chain execution' },
        ].map(({ name, desc }) => (
          <div key={name} className="p-3 rounded-lg border bg-muted/30">
            <p className="font-medium">{name}</p>
            <p>{desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
