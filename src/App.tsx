import React, { useMemo, useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { MinerProvider, useMiner } from './context/MinerContext';
import { UPGRADES } from './lib/gameConfig';
import { TopBar, type AppTab } from './components/TopBar';
import { MinerStage } from './components/MinerStage';
import { UpgradesPanel } from './components/UpgradesPanel';
import { AiAnswerPanel } from './components/AiAnswerPanel';
import { LeaderboardView } from './components/LeaderboardView';
import { DailyQuizView } from './components/DailyQuizView';

function DashboardShell() {
  const [activeTab, setActiveTab] = useState<AppTab>('miner');
  const { user, miner, stats, authError, clearAuthError, signIn } = useMiner();

  const nextUpgradeInfo = useMemo(() => {
    const items = UPGRADES.map((def) => {
      const level = def.getLevel(miner);
      const cost = def.getCost(level);
      const effect = def.formatEffect(miner);
      return { def, level, cost, effectNext: effect.next };
    }).sort((a, b) => a.cost - b.cost);

    const affordable = items.find((i) => miner.balance >= i.cost);
    return affordable ?? items[0] ?? null;
  }, [miner]);

  return (
    <div className="min-h-screen bg-[#07080F] text-[#F8FAFC] flex flex-col">
      <TopBar activeTab={activeTab} onSelectTab={setActiveTab} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {authError && (
          <div
            role="alert"
            className="mb-6 flex items-center justify-between gap-4 rounded-xl border border-[#EF4444]/40 bg-[#EF4444]/10 px-4 py-3 text-xs text-[#FCA5A5]"
          >
            <div className="flex items-center gap-2.5">
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{authError}</span>
            </div>
            <button
              type="button"
              onClick={clearAuthError}
              aria-label="Dismiss error"
              className="rounded p-1 hover:bg-white/10"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {!user && activeTab === 'miner' && (
          <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#0E111D] px-4 py-3 text-xs">
            <span className="text-[#CBD5E1]">
              Playing in local guest mode. Sign in with Google anytime to save progress across devices and join the global leaderboard.
            </span>
            <button
              type="button"
              onClick={() => void signIn()}
              className="font-semibold text-[#F5B731] hover:underline whitespace-nowrap shrink-0 text-left sm:text-right"
            >
              Sync with Google Account →
            </button>
          </div>
        )}

        {activeTab === 'miner' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-7 space-y-6">
              <MinerStage />
              <AiAnswerPanel
                mode="miner"
                miner={miner}
                stats={stats}
                nextUpgrade={nextUpgradeInfo}
              />
            </div>
            <div className="lg:col-span-5">
              <UpgradesPanel />
            </div>
          </div>
        )}

        {activeTab === 'leaderboard' && <LeaderboardView />}

        {activeTab === 'quiz' && <DailyQuizView />}
      </main>

      <footer className="border-t border-white/8 py-4 text-center text-xs text-[#64748B]">
        Crypto Pi Token · Mainnet Tap &amp; Node Simulation
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <MinerProvider>
      <DashboardShell />
    </MinerProvider>
  );
}
