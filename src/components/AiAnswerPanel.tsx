import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import type { MinerComputedStats, MinerState, UpgradeDefinition } from '../lib/gameConfig';

interface MinerAiProps {
  mode: 'miner';
  miner: MinerState;
  stats: MinerComputedStats;
  nextUpgrade: {
    def: UpgradeDefinition;
    level: number;
    cost: number;
    effectNext: string;
  } | null;
}

interface QuizAiProps {
  mode: 'quiz';
  questionId: string;
  question: string;
  options: string[];
  correctAnswer: string;
  selectedAnswer: string;
  isCorrect: boolean;
  baseExplanation: string;
}

type AiAnswerPanelProps = MinerAiProps | QuizAiProps;

const clientExplanationCache = new Map<
  string,
  { explanation: string; source: 'gemini' | 'local' }
>();

export function AiAnswerPanel(props: AiAnswerPanelProps) {
  const requestKey =
    props.mode === 'miner'
      ? `miner:${props.miner.tapLevel}:${props.miner.passiveLevel}:${props.miner.consensusLevel}:${props.miner.vaultLevel}:${props.nextUpgrade?.def.id ?? 'none'}`
      : `quiz:${props.questionId}:${props.selectedAnswer}`;

  const [explanation, setExplanation] = useState<string>(() => {
    return clientExplanationCache.get(requestKey)?.explanation ?? '';
  });
  const [loading, setLoading] = useState<boolean>(false);
  const [source, setSource] = useState<'gemini' | 'local'>(() => {
    return clientExplanationCache.get(requestKey)?.source ?? 'gemini';
  });

  const latestPropsRef = useRef<AiAnswerPanelProps>(props);
  latestPropsRef.current = props;

  const fetchExplanation = useCallback(
    async (key: string, force = false) => {
      if (!force) {
        const cached = clientExplanationCache.get(key);
        if (cached) {
          setExplanation(cached.explanation);
          setSource(cached.source);
          return;
        }
      }

      const current = latestPropsRef.current;
      setLoading(true);

      try {
        const body =
          current.mode === 'miner'
            ? {
                mode: 'miner' as const,
                force,
                balance: current.miner.balance,
                totalMined: current.miner.totalMined,
                tapValue: current.stats.tapValue,
                passiveRate: current.stats.passiveRate,
                tapLevel: current.miner.tapLevel,
                passiveLevel: current.miner.passiveLevel,
                consensusLevel: current.miner.consensusLevel,
                vaultLevel: current.miner.vaultLevel,
                nextUpgradeName: current.nextUpgrade?.def.name,
                nextUpgradeCost: current.nextUpgrade?.cost,
                nextUpgradeEffect: current.nextUpgrade?.effectNext,
              }
            : {
                mode: 'quiz' as const,
                force,
                question: current.question,
                options: current.options,
                correctAnswer: current.correctAnswer,
                selectedAnswer: current.selectedAnswer,
                isCorrect: current.isCorrect,
                baseExplanation: current.baseExplanation,
              };

        const res = await fetch('/api/ai/explain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          throw new Error('Failed to reach AI explanation endpoint');
        }

        const data = (await res.json()) as {
          explanation: string;
          source?: 'gemini' | 'local';
        };
        const resolvedSource = data.source ?? 'gemini';
        clientExplanationCache.set(key, {
          explanation: data.explanation,
          source: resolvedSource,
        });
        setExplanation(data.explanation);
        setSource(resolvedSource);
      } catch {
        const fallbackText =
          current.mode === 'quiz'
            ? current.baseExplanation
            : `Tap yield is ${current.stats.tapValue.toFixed(1)} π/tap (Quantum Tap Core Lv.${current.miner.tapLevel} boosted by Consensus Lv.${current.miner.consensusLevel}). Passive mining runs at ${current.stats.passiveRate.toFixed(2)} π/sec.`;
        setExplanation(fallbackText);
        setSource('local');
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void fetchExplanation(requestKey, false);
  }, [requestKey, fetchExplanation]);

  return (
    <aside
      aria-label="AI-generated answer panel"
      className="rounded-xl border border-[#8B5CF6]/40 bg-[#121024] p-4 sm:p-5"
    >
      <div className="flex items-center justify-between gap-3 mb-2.5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[#A855F7]" aria-hidden="true" />
          <span className="text-xs font-semibold tracking-wide text-[#E2D9FF]">
            AI-Generated Answer
          </span>
          <span aria-hidden="true" className="text-xs text-[#64748B]">
            ·
          </span>
          <span className="text-xs text-[#94A3B8]">
            {props.mode === 'miner' ? 'Mining Strategy' : 'Concept Breakdown'}
          </span>
        </div>

        <button
          type="button"
          disabled={loading}
          onClick={() => void fetchExplanation(requestKey, true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-[#1A1633] px-2.5 py-1 text-xs font-medium text-[#CBD5E1] transition-colors hover:border-[#8B5CF6]/60 hover:text-white disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          <RefreshCw
            className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          <span>{loading ? 'Analyzing' : 'Refresh'}</span>
        </button>
      </div>

      {loading && !explanation ? (
        <div className="space-y-2 py-1" aria-busy="true">
          <div className="h-3.5 w-full rounded bg-white/10" />
          <div className="h-3.5 w-4/5 rounded bg-white/10" />
        </div>
      ) : (
        <p className="text-sm leading-relaxed text-[#E2E8F0]">
          {explanation}
        </p>
      )}

      <p className="mt-2.5 text-[11px] text-[#94A3B8]">
        {source === 'gemini'
          ? 'Generated by AI based on your live state.'
          : 'AI summary generated from your current setup.'}
      </p>
    </aside>
  );
}
