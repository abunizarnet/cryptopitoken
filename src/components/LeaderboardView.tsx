import React, { useEffect, useState } from 'react';
import {
  collection,
  getCountFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { Check, Edit3, Trophy, UserCheck, X } from 'lucide-react';
import { useMiner } from '../context/MinerContext';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { computeMinerStats, formatPi, sanitizePiHandle, SCHEMA_LIMITS } from '../lib/gameConfig';
import { authenticateWithPiSandbox, isPiSdkAvailable } from '../lib/piSdk';

interface LeaderboardRow {
  uid: string;
  piHandle: string;
  displayName: string;
  totalMined: number;
  tapLevel: number;
  passiveLevel: number;
  consensusLevel: number;
  vaultLevel: number;
}

export function LeaderboardView() {
  const { user, miner, stats, piHandle, displayName, signIn, updatePiHandle } = useMiner();
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [exactRank, setExactRank] = useState<number | null>(null);

  const [editingHandle, setEditingHandle] = useState(false);
  const [handleInput, setHandleInput] = useState(piHandle);
  const [handleError, setHandleError] = useState<string | null>(null);
  const [savingHandle, setSavingHandle] = useState(false);
  const [linkingPi, setLinkingPi] = useState(false);

  useEffect(() => {
    setHandleInput(piHandle);
  }, [piHandle]);

  useEffect(() => {
    const lbQuery = query(
      collection(db, 'leaderboard'),
      where('totalMined', '>=', 0),
      orderBy('totalMined', 'desc'),
      limit(50)
    );

    const unsubscribe = onSnapshot(
      lbQuery,
      (snapshot) => {
        const list: LeaderboardRow[] = snapshot.docs.map((d) => {
          const data = d.data();
          return {
            uid: String(data.uid ?? d.id),
            piHandle: String(data.piHandle ?? 'pioneer'),
            displayName: String(data.displayName ?? 'Pioneer'),
            totalMined: Number(data.totalMined ?? 0),
            tapLevel: Number(data.tapLevel ?? 1),
            passiveLevel: Number(data.passiveLevel ?? 0),
            consensusLevel: Number(data.consensusLevel ?? 0),
            vaultLevel: Number(data.vaultLevel ?? 0),
          };
        });
        setRows(list);
        setLoading(false);
        setErrorMsg(null);
      },
      (error) => {
        setLoading(false);
        setErrorMsg('Unable to load live leaderboard rankings right now.');
        handleFirestoreError(error, OperationType.LIST, 'leaderboard');
      }
    );

    return () => unsubscribe();
  }, []);

  // Compute player's exact rank even if outside top 50
  const indexInTop = user ? rows.findIndex((r) => r.uid === user.uid) : -1;

  useEffect(() => {
    if (!user) {
      setExactRank(null);
      return;
    }
    if (indexInTop !== -1) {
      setExactRank(indexInTop + 1);
      return;
    }

    let cancelled = false;
    async function fetchRank() {
      try {
        const aheadQuery = query(
          collection(db, 'leaderboard'),
          where('totalMined', '>', miner.totalMined)
        );
        const countSnap = await getCountFromServer(aheadQuery);
        if (!cancelled) {
          setExactRank(countSnap.data().count + 1);
        }
      } catch {
        // Fallback silently if offline
      }
    }
    void fetchRank();
    return () => {
      cancelled = true;
    };
  }, [user, indexInTop, miner.totalMined]);

  const handleSaveHandle = async (e: React.FormEvent) => {
    e.preventDefault();
    setHandleError(null);
    setSavingHandle(true);
    try {
      const res = await updatePiHandle(handleInput);
      if (!res.ok) {
        setHandleError(res.error ?? 'Invalid handle');
      } else {
        setEditingHandle(false);
      }
    } finally {
      setSavingHandle(false);
    }
  };

  const handleLinkPiSandbox = async () => {
    setHandleError(null);
    setLinkingPi(true);
    try {
      const piAuth = await authenticateWithPiSandbox();
      const sanitized = sanitizePiHandle(piAuth.username, piAuth.uid);
      const res = await updatePiHandle(sanitized);
      if (!res.ok) {
        setHandleError(res.error ?? 'Could not save Pi username');
      }
    } catch (err) {
      setHandleError(
        err instanceof Error
          ? err.message
          : 'Open this app inside sandbox.minepi.com or Pi Browser to authenticate with Pi SDK.'
      );
    } finally {
      setLinkingPi(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Pinned Player Rank Summary (always reachable) */}
      <section
        aria-label="Your leaderboard rank"
        className="rounded-2xl border border-[#8B5CF6]/40 bg-[#121024] p-5 sm:p-6"
      >
        {user ? (
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[#F5B731]/40 bg-[#090B14] font-mono tabular-nums text-lg font-bold text-[#F5B731] shrink-0">
                {exactRank ? `#${exactRank}` : '—'}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-lg font-bold text-[#F8FAFC] truncate">
                    {displayName}
                  </span>
                  <span aria-hidden="true" className="text-[#64748B]">·</span>
                  {!editingHandle ? (
                    <button
                      type="button"
                      onClick={() => setEditingHandle(true)}
                      className="inline-flex items-center gap-1.5 font-mono text-xs text-[#F5B731] hover:underline"
                    >
                      <span>@{piHandle}</span>
                      <Edit3 className="h-3 w-3 text-[#94A3B8]" aria-hidden="true" />
                    </button>
                  ) : (
                    <form onSubmit={(e) => void handleSaveHandle(e)} className="inline-flex items-center gap-1.5">
                      <input
                        type="text"
                        value={handleInput}
                        onChange={(e) => setHandleInput(e.target.value)}
                        minLength={SCHEMA_LIMITS.PI_HANDLE_MIN}
                        maxLength={SCHEMA_LIMITS.PI_HANDLE_MAX}
                        aria-label="Edit Pi handle"
                        className="w-36 rounded border border-white/20 bg-[#07080F] px-2 py-1 font-mono text-xs text-[#F8FAFC] focus:border-[#F5B731] focus:outline-none"
                      />
                      <button
                        type="submit"
                        disabled={savingHandle}
                        aria-label="Save handle"
                        className="rounded bg-[#F5B731] p-1 text-[#07080F] hover:bg-[#F7C75C]"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingHandle(false);
                          setHandleError(null);
                          setHandleInput(piHandle);
                        }}
                        aria-label="Cancel editing handle"
                        className="rounded border border-white/10 p-1 text-[#94A3B8] hover:text-white"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </form>
                  )}
                  {isPiSdkAvailable() && (
                    <>
                      <span aria-hidden="true" className="text-[#64748B]">·</span>
                      <button
                        type="button"
                        disabled={linkingPi}
                        onClick={() => void handleLinkPiSandbox()}
                        className="text-xs font-medium text-[#A855F7] hover:underline disabled:opacity-50"
                      >
                        {linkingPi ? 'Verifying Pi...' : 'Sync Pi Sandbox Username'}
                      </button>
                    </>
                  )}
                </div>
                {handleError && (
                  <p className="mt-1 text-xs text-[#F87171]">{handleError}</p>
                )}
                <p className="mt-0.5 text-xs text-[#94A3B8] font-mono tabular-nums">
                  {stats.tapValue.toFixed(1)} π/tap · {stats.passiveRate.toFixed(2)} π/sec
                </p>
              </div>
            </div>

            <div className="flex items-baseline gap-2 md:text-right">
              <span className="text-xs text-[#94A3B8]">Total Mined:</span>
              <span className="font-mono tabular-nums text-2xl font-bold text-[#F5B731]">
                {formatPi(miner.totalMined)} π
              </span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-bold text-[#F8FAFC]">
                Claim Your Global Mainnet Rank
              </h2>
              <p className="mt-0.5 text-xs text-[#94A3B8]">
                Sign in with Google to sync your {formatPi(miner.totalMined)} π mined onto the live global leaderboard.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void signIn()}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#F5B731] px-4 py-2.5 text-xs font-semibold text-[#07080F] hover:bg-[#F7C75C] whitespace-nowrap shrink-0"
            >
              <UserCheck className="h-4 w-4" aria-hidden="true" />
              <span>Sign in to Rank</span>
            </button>
          </div>
        )}
      </section>

      {/* Global Leaderboard Table */}
      <section
        aria-label="Global leaderboard rankings"
        className="rounded-2xl border border-white/10 bg-[#0E111D] overflow-hidden"
      >
        <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <Trophy className="h-5 w-5 text-[#F5B731]" aria-hidden="true" />
            <h1 className="font-display text-xl font-bold text-[#F8FAFC]">
              Global Pi Leaderboard
            </h1>
          </div>
          <span className="text-xs font-mono tabular-nums text-[#94A3B8]">
            Top {rows.length} Pioneers
          </span>
        </div>

        {errorMsg ? (
          <div className="p-8 text-center text-sm text-[#F87171]">{errorMsg}</div>
        ) : loading ? (
          <div className="divide-y divide-white/8">
            {Array.from({ length: 6 }).map((_, idx) => (
              <div key={idx} className="flex items-center justify-between px-6 py-4">
                <div className="h-4 w-48 rounded bg-white/10" />
                <div className="h-4 w-24 rounded bg-white/10" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-[#F8FAFC]">
              No ranked Pioneers yet
            </p>
            <p className="mt-1 text-xs text-[#94A3B8]">
              Sign in and start tapping the Pi coin to claim the #1 spot on Mainnet.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-xs font-medium text-[#94A3B8]">
                  <th className="py-3 pl-5 pr-3 sm:pl-6 w-20">Rank</th>
                  <th className="py-3 px-3">Pioneer</th>
                  <th className="py-3 px-3 text-right hidden sm:table-cell">Mining Rate</th>
                  <th className="py-3 pl-3 pr-5 sm:pr-6 text-right">Total Mined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/8 text-sm">
                {rows.map((row, index) => {
                  const rank = index + 1;
                  const isMe = user?.uid === row.uid;
                  const rowStats = computeMinerStats({
                    balance: 0,
                    totalMined: row.totalMined,
                    tapLevel: row.tapLevel,
                    passiveLevel: row.passiveLevel,
                    consensusLevel: row.consensusLevel,
                    vaultLevel: row.vaultLevel,
                    lastCollectAtMs: Date.now(),
                    lastQuizDate: '',
                  });

                  const rankColor =
                    rank === 1
                      ? 'text-[#F5B731]'
                      : rank === 2
                      ? 'text-[#E2E8F0]'
                      : rank === 3
                      ? 'text-[#C084FC]'
                      : 'text-[#94A3B8]';

                  return (
                    <tr
                      key={row.uid}
                      className={`transition-colors ${
                        isMe
                          ? 'bg-[#8B5CF6]/15'
                          : 'hover:bg-white/[0.03]'
                      }`}
                    >
                      <td className={`py-3.5 pl-5 pr-3 sm:pl-6 font-mono tabular-nums font-bold ${rankColor}`}>
                        #{rank}
                      </td>
                      <td className="py-3.5 px-3">
                        <div className="flex flex-col sm:flex-row sm:items-baseline sm:gap-2">
                          <span className="font-semibold text-[#F8FAFC]">
                            {row.displayName}
                            {isMe && (
                              <span className="ml-2 text-xs font-medium text-[#F5B731]">
                                (You)
                              </span>
                            )}
                          </span>
                          <span className="font-mono text-xs text-[#94A3B8]">
                            @{row.piHandle}
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 px-3 text-right font-mono tabular-nums text-xs text-[#94A3B8] hidden sm:table-cell">
                        {rowStats.tapValue.toFixed(1)}/tap · {rowStats.passiveRate.toFixed(2)}/s
                      </td>
                      <td className="py-3.5 pl-3 pr-5 sm:pr-6 text-right font-mono tabular-nums font-bold text-[#F5B731]">
                        {formatPi(row.totalMined)} π
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
