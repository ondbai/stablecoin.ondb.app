'use client';

import { ThemeToggle } from '@/components/theme-toggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { Wallet, ChevronDown, LogOut, ExternalLink, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { WalletState, WalletType, WalletInfo } from '@/lib/wallets';

interface HeaderProps {
  wallet: WalletState | null;
  availableWallets: WalletInfo[];
  onConnectWallet: (walletType: WalletType) => Promise<void>;
  onDisconnectWallet: () => Promise<void>;
  walletError: string | null;
}

const formatAddress = (addr: string) => {
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
};

export function Header({
  wallet,
  availableWallets,
  onConnectWallet,
  onDisconnectWallet,
  walletError,
}: HeaderProps) {
  const [copied, setCopied] = useState(false);

  const copyAddress = () => {
    if (wallet?.address) {
      navigator.clipboard.writeText(wallet.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between px-4 max-w-6xl mx-auto">
        <div className="flex items-center gap-4">
          <img
            src="/stacky-bullish.png"
            alt="Stacky Bullish"
            className="h-10 w-auto object-contain"
          />
          <div className="flex flex-col">
            <h1 className="text-xl font-bold tracking-tight">VietRSD</h1>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">UTXO Stablecoin</span>
              <Badge variant="outline" className="text-[10px] h-4 px-1">
                v3
              </Badge>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <a
            href="https://onchaindb.io"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors hidden sm:flex items-center gap-1"
          >
            Powered by OnChainDB
            <ExternalLink className="h-3 w-3" />
          </a>

          <Separator orientation="vertical" className="h-6 hidden sm:block" />

          <ThemeToggle />

          {wallet ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <div className="h-2 w-2 rounded-full bg-green-500" />
                  <span className="font-mono text-sm hidden sm:inline">
                    {formatAddress(wallet.address)}
                  </span>
                  <span className="font-mono text-sm sm:hidden">
                    {wallet.address.slice(0, 6)}...
                  </span>
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <div className="px-2 py-1.5">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="secondary" className="text-xs">
                      {wallet.walletType}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {wallet.chainId}
                    </Badge>
                  </div>
                  <p className="font-mono text-xs text-muted-foreground break-all">
                    {wallet.address}
                  </p>
                  {wallet.walletType === 'keplr' && wallet.balance && (
                    <p className="text-sm mt-1">{wallet.balance} TIA</p>
                  )}
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={copyAddress}>
                  {copied ? (
                    <Check className="mr-2 h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="mr-2 h-4 w-4" />
                  )}
                  {copied ? 'Copied!' : 'Copy Address'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onDisconnectWallet}
                  className="text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Disconnect
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="gap-2">
                  <Wallet className="h-4 w-4" />
                  Connect
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {availableWallets.length === 0 ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                    Loading wallets...
                  </div>
                ) : (
                  availableWallets.map((w) => (
                    <DropdownMenuItem
                      key={w.type}
                      onClick={() => w.installed && onConnectWallet(w.type)}
                      disabled={!w.installed}
                      className="flex flex-col items-start gap-0.5"
                    >
                      <div className="flex items-center gap-2 w-full">
                        <span className="font-medium">{w.name}</span>
                        {!w.installed && (
                          <Badge variant="outline" className="text-[10px] ml-auto">
                            Not installed
                          </Badge>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {w.description}
                      </span>
                    </DropdownMenuItem>
                  ))
                )}
                {walletError && (
                  <>
                    <DropdownMenuSeparator />
                    <div className="px-2 py-1.5 text-xs text-destructive">
                      {walletError}
                    </div>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </header>
  );
}
