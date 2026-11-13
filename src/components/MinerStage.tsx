import React, { useCallback, useRef, useState } from 'react';
import { Volume2, VolumeX, Zap } from 'lucide-react';
import { useMiner } from '../context/MinerContext';
import { formatPi } from '../lib/gameConfig';
import piCoinImg from '../assets/images/pi_coin_emblem_1794597868751.jpg';

interface FloatingGain {
  id: number;
  x: number;
  y: number;
  amount: number;
}

export function MinerStage() {
  const { miner, stats, pendingPassive, tapCoin, collectPassive } = useMiner();
  const [floatingGains, setFloatingGains] = useState<FloatingGain[]>([]);
  const [tilt, setTilt] = useState({ x: 0, y: 0, pressed: false });
  const [collecting, setCollecting] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [imgError, setImgError] = useState(false);

  const nextFloatIdRef = useRef(1);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const playTapTone = useCallback(() => {
    if (!soundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioCtx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        void ctx.resume();
      }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(620, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(920, ctx.currentTime + 0.06);
      gain.gain.setValueAtTime(0.05, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.085);
    } catch {
      // Ignore audio failures
    }
  }, [soundEnabled]);

  const handleCoinTap = (e: React.PointerEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = e.clientX ? e.clientX - rect.left : rect.width / 2;
    const relY = e.clientY ? e.clientY - rect.top : rect.height / 2;

    const normX = ((relX / rect.width) - 0.5) * 18;
    const normY = ((relY / rect.height) - 0.5) * -18;
    setTilt({ x: normY, y: normX, pressed: true });
    window.setTimeout(() => {
      setTilt({ x: 0, y: 0, pressed: false });
    }, 110);

    const gained = tapCoin();
    playTapTone();

    const id = nextFloatIdRef.current++;
    setFloatingGains((prev) => [...prev.slice(-14), { id, x: relX, y: relY, amount: gained }]);
    window.setTimeout(() => {
      setFloatingGains((prev) => prev.filter((item) => item.id !== id));
    }, 760);
  };

  const handleCollect = async () => {
    if (pendingPassive < 0.01 || collecting) return;
    setCollecting(true);
    try {
      await collectPassive();
    } finally {
      setCollecting(false);
    }
  };

  const vaultFillPct =
    stats.maxVaultCoins > 0
      ? Math.min(100, Math.round((pendingPassive / stats.maxVaultCoins) * 100))
      : 0;

  return (
    <section
      aria-label="Pi Coin Miner"
      className="flex flex-col items-center rounded-2xl border border-white/10 bg-[#0E111D] px-6 py-8 sm:px-10 sm:py-10"
    >
      {/* Prominent Coin Balance Display above coin */}
      <div className="w-full flex items-start justify-between gap-4 mb-2">
        <div className="w-9" aria-hidden="true" />
        <div className="text-center">
          <p className="text-xs font-medium text-[#94A3B8] mb-1">
            Available Pi Balance
          </p>
          <div className="flex items-baseline justify-center gap-2">
            <span className="font-mono tabular-nums text-4xl sm:text-5xl font-bold tracking-tight text-[#F5B731]">
              {formatPi(miner.balance)}
            </span>
            <span className="font-display text-xl font-bold text-[#A855F7]">π</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setSoundEnabled((prev) => !prev)}
          aria-label={soundEnabled ? 'Mute tap chime' : 'Enable tap chime'}
          title={soundEnabled ? 'Mute tap chime' : 'Enable tap chime'}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#15192B] text-[#94A3B8] transition-colors hover:text-[#F8FAFC] shrink-0"
        >
          {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
        </button>
      </div>

      {/* Unboxed quiet metadata line */}
      <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-xs text-[#94A3B8] font-mono tabular-nums mb-8">
        <span>+{stats.tapValue.toFixed(1)} π / tap</span>
        <span aria-hidden="true" className="text-white/25">·</span>
        <span>+{stats.passiveRate.toFixed(2)} π / sec passive</span>
        <span aria-hidden="true" className="text-white/25">·</span>
        <span>{formatPi(miner.totalMined)} π lifetime mined</span>
      </div>

      {/* Large Spinning Pi Coin Centerpiece */}
      <div className="relative flex items-center justify-center my-2">
        {/* Ambient radial glow behind coin */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute h-64 w-64 sm:h-72 sm:w-72 rounded-full bg-radial from-[#8B5CF6]/30 via-[#F5B731]/10 to-transparent blur-2xl"
        />

        <button
          type="button"
          onPointerDown={handleCoinTap}
          aria-label="Tap spinning Pi coin to mine"
          style={{
            transform: `perspective(700px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg) scale(${
              tilt.pressed ? 0.94 : 1
            })`,
          }}
          className="group relative h-56 w-56 sm:h-64 sm:w-64 rounded-full p-2 transition-transform duration-100 ease-out cursor-pointer select-none touch-manipulation focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#F5B731]/60"
        >
          {/* Metallic outer gold/purple bezel */}
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-full border-2 border-[#F5B731]/60 shadow-[0_0_45px_rgba(139,92,246,0.35)] group-hover:border-[#F5B731] transition-colors"
          />

          {/* Continuous spinning medallion */}
          <div className="relative h-full w-full overflow-hidden rounded-full bg-[#07080F]">
            {!imgError ? (
              <img
                src={piCoinImg}
                alt="Spinning Pi Network Gold and Purple Medallion Coin"
                referrerPolicy="no-referrer"
                draggable={false}
                onError={() => setImgError(true)}
                className="h-full w-full object-cover scale-105 animate-coin-orbit select-none pointer-events-none"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br from-[#2B1758] via-[#131129] to-[#442C07] animate-coin-orbit">
                <span className="font-display text-7xl font-extrabold text-[#F5B731]">π</span>
              </div>
            )}
          </div>

          {/* Floating tap reward popups */}
          {floatingGains.map((item) => (
            <span
              key={item.id}
              aria-hidden="true"
              style={{ left: item.x, top: item.y }}
              className="pointer-events-none absolute z-20 font-mono tabular-nums text-lg font-bold text-[#F5B731] drop-shadow-[0_2px_8px_rgba(7,8,15,0.95)] animate-float-up"
            >
              +{item.amount.toFixed(1)} π
            </span>
          ))}
        </button>
      </div>

      <p className="mt-4 text-xs text-[#94A3B8]">
        Tap the Pi coin to mine immediately — zero setup required.
      </p>

      {/* Passive Mining Collection Bar */}
      <div className="mt-8 w-full rounded-xl border border-white/10 bg-[#090B14] p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs text-[#94A3B8]">
              <Zap className="h-3.5 w-3.5 text-[#A855F7]" aria-hidden="true" />
              <span>Passive Node Vault</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {stats.passiveRate > 0 ? `${vaultFillPct}% of ${stats.vaultHours}h cap` : 'Inactive'}
              </span>
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-mono tabular-nums text-2xl font-bold text-[#F8FAFC]">
                +{pendingPassive.toFixed(2)}
              </span>
              <span className="text-sm font-semibold text-[#F5B731]">π ready to collect</span>
            </div>
            {/* Vault Fill Meter */}
            <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-white/8">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#8B5CF6] to-[#F5B731] transition-all duration-300"
                style={{ width: `${stats.passiveRate > 0 ? Math.max(2, vaultFillPct) : 0}%` }}
              />
            </div>
          </div>

          <button
            type="button"
            disabled={pendingPassive < 0.01 || collecting}
            onClick={() => void handleCollect()}
            className="inline-flex items-center justify-center rounded-lg bg-[#8B5CF6] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#7C3AED] disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-[#64748B] whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B5CF6]"
          >
            {collecting ? 'Collecting...' : 'Collect'}
          </button>
        </div>
      </div>
    </section>
  );
}
