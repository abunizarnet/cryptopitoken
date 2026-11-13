import React from 'react';
import { LogIn, LogOut } from 'lucide-react';
import { useMiner } from '../context/MinerContext';

export type AppTab = 'miner' | 'leaderboard' | 'quiz';

interface TopBarProps {
  activeTab: AppTab;
  onSelectTab: (tab: AppTab) => void;
}

export function TopBar({ activeTab, onSelectTab }: TopBarProps) {
  const { user, piHandle, isSigningIn, signIn, signOut, todayQuizAttempted } = useMiner();

  const navItems: { id: AppTab; label: string }[] = [
    { id: 'miner', label: 'Miner' },
    { id: 'leaderboard', label: 'Leaderboard' },
    { id: 'quiz', label: todayQuizAttempted ? 'Daily Quiz (Done)' : 'Daily Quiz' },
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#07080F]/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-8 px-4 py-3.5 sm:px-6">
        {/* Zone 1: Single-line Brand Title */}
        <button
          type="button"
          onClick={() => onSelectTab('miner')}
          className="font-display text-lg font-bold tracking-tight text-[#F8FAFC] whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5B731] rounded"
        >
          Crypto Pi Token
        </button>

        {/* Zone 2: Concise single-line navigation links */}
        <nav aria-label="Primary navigation" className="hidden md:flex items-center gap-7">
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`relative py-1 text-sm font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B5CF6] rounded ${
                  active
                    ? 'text-[#F5B731]'
                    : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                }`}
              >
                {item.label}
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 -bottom-[15px] h-0.5 bg-[#F5B731]"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Single primary action */}
        <div className="flex items-center shrink-0">
          {user ? (
            <button
              type="button"
              onClick={() => void signOut()}
              title={`Signed in as @${piHandle} — Click to sign out`}
              className="inline-flex items-center gap-2 rounded-lg border border-white/12 bg-[#0E111D] px-3.5 py-2 text-xs font-medium text-[#F8FAFC] transition-colors hover:border-[#8B5CF6]/60 hover:bg-[#15192B] whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B5CF6]"
            >
              <span className="max-w-[130px] truncate font-mono text-[#F5B731]">
                @{piHandle}
              </span>
              <LogOut className="h-3.5 w-3.5 text-[#94A3B8]" aria-hidden="true" />
              <span className="sr-only">Sign out</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={isSigningIn}
              onClick={() => void signIn()}
              className="inline-flex items-center gap-2 rounded-lg bg-[#F5B731] px-4 py-2 text-xs font-semibold text-[#07080F] transition-colors hover:bg-[#F7C75C] disabled:opacity-60 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5B731] focus-visible:ring-offset-2 focus-visible:ring-offset-[#07080F]"
            >
              <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{isSigningIn ? 'Connecting...' : 'Sign in with Google'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Compact mobile nav bar kept well under 15% viewport height */}
      <nav
        aria-label="Mobile navigation"
        className="flex md:hidden items-center justify-around border-t border-white/8 px-2 py-1.5"
      >
        {navItems.map((item) => {
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                active
                  ? 'bg-[#15192B] text-[#F5B731]'
                  : 'text-[#94A3B8] hover:text-[#F8FAFC]'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
