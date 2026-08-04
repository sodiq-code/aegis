/**
 * Aegis Dashboard — Main Page
 * 
 * Institutional Treasury Layer on Flare
 * 
 * Three views: Treasury, Policy, Audit
 * Connected to Flare RPC (Coston2) and FCC extension proxy
 * 
 * Production polish: Error boundaries, Suspense, view transitions, toast system.
 */

'use client';

import { useState, Suspense } from 'react';
import { AegisNavbar } from '@/components/aegis/navbar';
import { AegisSidebar, AegisView } from '@/components/aegis/sidebar';
import { TreasuryView } from '@/components/aegis/treasury-view';
import { PolicyView } from '@/components/aegis/policy-view';
import { AuditView } from '@/components/aegis/audit-view';
import { AegisErrorBoundary } from '@/components/aegis/error-boundary';
import { useWalletStore } from '@/lib/wallet-auth';
import { Shield, Wallet, ArrowRight, Sparkles, FileLock2, ScanSearch, Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { motion, AnimatePresence } from 'framer-motion';

// View transition animation config
const viewVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

const viewTransition = {
  duration: 0.2,
  ease: 'easeOut' as const,
};

export default function AegisDashboard() {
  const [activeView, setActiveView] = useState<AegisView>('treasury');
  const { status, connectEvm } = useWalletStore();

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
              className="capitalize transition-all"
            >
              {view}
            </Button>
          ))}
        </div>

        {/* Main Content */}
        <main className="flex-1 p-4 md:p-6 overflow-auto">
          {status === 'disconnected' ? (
            <WelcomeScreen onConnect={connectEvm} />
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={activeView}
                initial={viewVariants.initial}
                animate={viewVariants.animate}
                exit={viewVariants.exit}
                transition={viewTransition}
              >
                <AegisErrorBoundary viewName={activeView}>
                  <Suspense fallback={<ViewLoadingSkeleton />}>
                    {activeView === 'treasury' && <TreasuryView />}
                    {activeView === 'policy' && <PolicyView />}
                    {activeView === 'audit' && <AuditView />}
                  </Suspense>
                </AegisErrorBoundary>
              </motion.div>
            </AnimatePresence>
          )}
        </main>
      </div>

      {/* Footer */}
      <footer className="border-t py-3 px-4 text-center text-xs text-muted-foreground">
        <span className="flex items-center justify-center gap-2 flex-wrap">
          <Shield className="h-3 w-3 text-emerald-600" />
          Aegis — Institutional Treasury Layer on Flare
          <span className="text-border">|</span>
          <a
            href="https://coston2-explorer.flare.network/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground transition-colors inline-flex items-center gap-0.5"
          >
            Coston2 Explorer <ArrowRight className="h-3 w-3" />
          </a>
          <span className="text-border">|</span>
          <a
            href="https://dev.flare.network/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground transition-colors inline-flex items-center gap-0.5"
          >
            Flare Dev Hub <ArrowRight className="h-3 w-3" />
          </a>
          <span className="text-border">|</span>
          <a
            href="https://dev.flare.network/fassets/developer-guides/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground transition-colors inline-flex items-center gap-0.5"
          >
            FAssets Guide <ArrowRight className="h-3 w-3" />
          </a>
        </span>
      </footer>
    </div>
  );
}

function WelcomeScreen({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-6">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      >
        <Shield className="h-16 w-16 text-emerald-600" />
      </motion.div>

      <motion.div
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.1 }}
      >
        <h2 className="text-3xl font-bold tracking-tight">Welcome to Aegis</h2>
        <p className="text-muted-foreground mt-2 max-w-lg">
          The institutional treasury layer for XRP-native DeFi on Flare.
          Connect your wallet to access the dashboard and manage your vault.
        </p>
      </motion.div>

      <motion.div
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="flex flex-col items-center gap-3"
      >
        <Button onClick={onConnect} size="lg" className="gap-2">
          <Wallet className="h-5 w-5" />
          Connect Wallet
        </Button>
        <span className="text-sm text-muted-foreground">
          MetaMask (EVM) or Xaman (XRPL)
        </span>
      </motion.div>

      <motion.div
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.3 }}
        className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs text-muted-foreground w-full max-w-2xl"
      >
        {[
          { name: 'FAssets (FXRP)', desc: 'Core asset', icon: Sparkles },
          { name: 'FTSO V2', desc: 'Price feeds', icon: ArrowRight },
          { name: 'FDC', desc: 'Attestations', icon: ScanSearch },
          { name: 'FCC', desc: 'Confidential compute', icon: FileLock2 },
          { name: 'PMW', desc: 'Cross-chain exec', icon: Bot },
        ].map(({ name, desc, icon: Icon }) => (
          <Card key={name} className="p-3 bg-muted/30 transition-shadow hover:shadow-sm">
            <Icon className="h-4 w-4 text-emerald-500 mb-1.5" />
            <p className="font-medium">{name}</p>
            <p className="text-muted-foreground">{desc}</p>
          </Card>
        ))}
      </motion.div>
    </div>
  );
}

/**
 * Lightweight loading skeleton for view transitions
 */
function ViewLoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-8 w-32 bg-muted rounded" />
        <div className="h-8 w-24 bg-muted rounded" />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-24 bg-muted rounded-lg" />
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {[1, 2].map(i => (
          <div key={i} className="h-40 bg-muted rounded-lg" />
        ))}
      </div>
    </div>
  );
}
