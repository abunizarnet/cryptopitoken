import React, { useState } from 'react';
import { ArrowUpRight, Lock } from 'lucide-react';
import { useMiner } from '../context/MinerContext';
import { formatPi, UPGRADES, type UpgradeId } from '../lib/gameConfig';

export function UpgradesPanel() {
  const { miner, purchaseUpgrade } = useMiner();
  const [buyingId, setBuyingId] = useState<UpgradeId | null>(null);

  const handleBuy = async (id: UpgradeId) => {
    if (buyingId) return;
    setBuyingId(id);
    try {
      await purchaseUpgrade(id);
    } finally {
      setBuyingId(null);
    }
  };

  return (
    <section
      aria-label="Miner upgrades"
      className="rounded-2xl border border-white/10 bg-[#0E111D] p-5 sm:p-6"
    >
      <div className="flex items-baseline justify-between gap-4 mb-4">
        <div>
          <h2 className="font-display text-xl font-bold text-[#F8FAFC]">
            Node &amp; Tap Upgrades
          </h2>
          <p className="mt-0.5 text-xs text-[#94A3B8]">
            Repeatable boosts that raise tap yield and passive π/sec mining.
          </p>
        </div>
      </div>

      <div className="divide-y divide-white/8">
        {UPGRADES.map((upgrade) => {
          const level = upgrade.getLevel(miner);
          const isMaxed = level >= upgrade.maxLevel;
          const cost = upgrade.getCost(level);
          const canAfford = !isMaxed && miner.balance >= cost;
          const deficit = Math.max(0, cost - miner.balance);
          const effect = upgrade.formatEffect(miner);

          return (
            <div
              key={upgrade.id}
              className={`py-4 first:pt-2 last:pb-1 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-opacity ${
                canAfford || isMaxed ? 'opacity-100' : 'opacity-65'
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2.5">
                  <h3 className="text-sm font-semibold text-[#F8FAFC]">
                    {upgrade.name}
                  </h3>
                  <span className="font-mono tabular-nums text-xs font-semibold text-[#A855F7]">
                    Lv.{level}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[#94A3B8]">
                  {upgrade.summary}
                </p>
                <div className="mt-1.5 flex items-center gap-2 font-mono tabular-nums text-xs">
                  <span className="text-[#CBD5E1]">{effect.current}</span>
                  {!isMaxed && (
                    <>
                      <span aria-hidden="true" className="text-[#64748B]">→</span>
                      <span className="font-semibold text-[#F5B731]">{effect.next}</span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex flex-col items-stretch sm:items-end gap-1 shrink-0">
                <button
                  type="button"
                  disabled={!canAfford || buyingId === upgrade.id}
                  onClick={() => void handleBuy(upgrade.id)}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5B731] ${
                    canAfford
                      ? 'bg-[#F5B731] text-[#07080F] hover:bg-[#F7C75C]'
                      : 'border border-white/10 bg-[#15192B] text-[#64748B] cursor-not-allowed'
                  }`}
                >
                  {!canAfford && !isMaxed && (
                    <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {canAfford && (
                    <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  <span className="font-mono tabular-nums">
                    {isMaxed
                      ? 'Max Level'
                      : buyingId === upgrade.id
                      ? 'Upgrading...'
                      : `Upgrade · ${formatPi(cost)} π`}
                  </span>
                </button>
                {!canAfford && !isMaxed && (
                  <span className="text-[11px] font-mono tabular-nums text-[#94A3B8] text-center sm:text-right">
                    Need {formatPi(deficit)} more π
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
