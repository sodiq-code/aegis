/**
 * Aegis Navigation Bar
 * 
 * Top navigation with wallet connection, role switching, and theme toggle.
 * Production polish: loading states, error display, accessibility.
 */

'use client';

import { useWalletStore } from '@/lib/wallet-auth';
import { useXamanWallet } from '@/lib/wallet-auth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ThemeToggle } from '@/components/theme-toggle';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { Wallet, Shield, ChevronDown, LogOut, User, Loader2 } from 'lucide-react';

export function AegisNavbar() {
  const { status, address, balance, type, role, error, connectEvm, disconnect, switchRole } = useWalletStore();
  const { connectXrpl } = useXamanWallet();

  const shortAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : null;

  const roleLabel = role === 'depositor' ? 'Depositor' : role === 'auditor' ? 'Auditor' : 'Admin';
  const roleColor = role === 'depositor' ? 'default' : role === 'auditor' ? 'secondary' : 'destructive';

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between px-4">
        {/* Logo & Title */}
        <div className="flex items-center gap-3">
          <Shield className="h-8 w-8 text-emerald-600" />
          <div>
            <h1 className="text-lg font-bold tracking-tight">Aegis</h1>
            <p className="text-xs text-muted-foreground hidden sm:block">Institutional Treasury Layer on Flare</p>
          </div>
        </div>

        {/* Network & Role Badge */}
        <div className="hidden md:flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            Coston2 Testnet
          </Badge>
          <Badge variant={roleColor as 'default' | 'secondary' | 'destructive'} className="text-xs">
            {roleLabel}
          </Badge>
        </div>

        {/* Right side: Theme + Wallet */}
        <div className="flex items-center gap-2">
          <ThemeToggle />

          {status === 'connected' ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2 transition-all">
                  <Wallet className="h-4 w-4" />
                  <span className="hidden sm:inline">{shortAddress}</span>
                  {balance && (
                    <span className="text-xs text-muted-foreground">
                      ({balance} {type === 'evm' ? 'CFLR' : 'XRP'})
                    </span>
                  )}
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Wallet</DropdownMenuLabel>
                <DropdownMenuItem className="text-xs text-muted-foreground font-mono">
                  <User className="mr-2 h-3 w-3" />
                  {address}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Role</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => switchRole('depositor')} className={role === 'depositor' ? 'bg-accent' : ''}>
                  Depositor
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => switchRole('auditor')} className={role === 'auditor' ? 'bg-accent' : ''}>
                  Auditor
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => switchRole('admin')} className={role === 'admin' ? 'bg-accent' : ''}>
                  Admin
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={disconnect} className="text-red-600">
                  <LogOut className="mr-2 h-3 w-3" />
                  Disconnect
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                onClick={connectEvm}
                disabled={status === 'connecting'}
                size="sm"
                className="gap-2 transition-all"
              >
                {status === 'connecting' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wallet className="h-4 w-4" />
                )}
                {status === 'connecting' ? 'Connecting...' : 'MetaMask'}
              </Button>
              <Button
                onClick={connectXrpl}
                variant="outline"
                size="sm"
                className="gap-2 transition-all"
              >
                <Wallet className="h-4 w-4" />
                <span className="hidden sm:inline">Xaman</span>
                <span className="sm:hidden">XRPL</span>
              </Button>
            </div>
          )}

          {error && (
            <p className="text-xs text-red-500 max-w-[200px] truncate" role="alert">{error}</p>
          )}
        </div>
      </div>
    </header>
  );
}
