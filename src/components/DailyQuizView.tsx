import React, { useEffect, useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { ArrowRight, CheckCircle2, Clock, HelpCircle, XCircle } from 'lucide-react';
import { useMiner } from '../context/MinerContext';
import { db } from '../lib/firebase';
import {
  formatCountdown,
  formatPi,
  getDailyQuizQuestions,
  getMsUntilNextUtcMidnight,
  getUtcDateKey,
  QUIZ_COMPLETION_BONUS,
  QUIZ_REWARD_PER_CORRECT,
} from '../lib/gameConfig';
import { AiAnswerPanel } from './AiAnswerPanel';

interface SavedQuizSummary {
  score: number;
  totalQuestions: number;
  coinsEarned: number;
}

export function DailyQuizView() {
  const { user, todayQuizAttempted, submitDailyQuiz, signIn } = useMiner();
  const [dateKey, setDateKey] = useState(() => getUtcDateKey());
  const [msLeft, setMsLeft] = useState(() => getMsUntilNextUtcMidnight());

  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [savedSummary, setSavedSummary] = useState<SavedQuizSummary | null>(null);
  const [localDoneSummary, setLocalDoneSummary] = useState<SavedQuizSummary | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const nextKey = getUtcDateKey();
      if (nextKey !== dateKey) {
        setDateKey(nextKey);
        setCurrentIdx(0);
        setSelectedIdx(null);
        setCorrectCount(0);
        setSavedSummary(null);
        setLocalDoneSummary(null);
      }
      setMsLeft(getMsUntilNextUtcMidnight());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [dateKey]);

  useEffect(() => {
    if (!user || !todayQuizAttempted) return;
    let cancelled = false;
    async function loadSavedAttempt() {
      if (!user) return;
      try {
        const snap = await getDoc(doc(db, 'users', user.uid, 'quiz_attempts', dateKey));
        if (snap.exists() && !cancelled) {
          const data = snap.data();
          setSavedSummary({
            score: Number(data.score ?? 0),
            totalQuestions: Number(data.totalQuestions ?? 5),
            coinsEarned: Number(data.coinsEarned ?? 0),
          });
        }
      } catch {
        // Handled cleanly via todayQuizAttempted fallback
      }
    }
    void loadSavedAttempt();
    return () => {
      cancelled = true;
    };
  }, [user, todayQuizAttempted, dateKey]);

  const questions = useMemo(() => getDailyQuizQuestions(dateKey), [dateKey]);
  const activeQuestion = questions[currentIdx];
  const hasAnswered = selectedIdx !== null;
  const isCorrect =
    hasAnswered && activeQuestion && selectedIdx === activeQuestion.correctIndex;

  const handleSelectOption = (idx: number) => {
    if (hasAnswered || todayQuizAttempted) return;
    setSelectedIdx(idx);
    if (idx === activeQuestion.correctIndex) {
      setCorrectCount((prev) => prev + 1);
    }
  };

  const handleNextOrFinish = async () => {
    if (!hasAnswered) return;

    if (currentIdx < questions.length - 1) {
      setCurrentIdx((prev) => prev + 1);
      setSelectedIdx(null);
      return;
    }

    setSubmitting(true);
    try {
      const earned = correctCount * QUIZ_REWARD_PER_CORRECT + QUIZ_COMPLETION_BONUS;
      await submitDailyQuiz(correctCount, questions.length, earned);
      setLocalDoneSummary({
        score: correctCount,
        totalQuestions: questions.length,
        coinsEarned: earned,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const summary = savedSummary ?? localDoneSummary;

  if (todayQuizAttempted) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <section className="rounded-2xl border border-white/10 bg-[#0E111D] p-6 sm:p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-[#F5B731]/40 bg-[#15192B]">
            <CheckCircle2 className="h-6 w-6 text-[#F5B731]" aria-hidden="true" />
          </div>
          <h1 className="font-display text-2xl font-bold text-[#F8FAFC]">
            Today’s Daily Crypto Quiz Complete
          </h1>
          <p className="mt-2 text-sm text-[#94A3B8]">
            You have completed the daily blockchain challenge for {dateKey} (UTC).
          </p>

          {summary && (
            <div className="mt-6 grid grid-cols-2 gap-4 rounded-xl border border-white/10 bg-[#090B14] p-4 max-w-md mx-auto">
              <div>
                <p className="text-xs text-[#94A3B8]">Score</p>
                <p className="mt-1 font-mono tabular-nums text-xl font-bold text-[#F8FAFC]">
                  {summary.score} / {summary.totalQuestions}
                </p>
              </div>
              <div>
                <p className="text-xs text-[#94A3B8]">Bonus Awarded</p>
                <p className="mt-1 font-mono tabular-nums text-xl font-bold text-[#F5B731]">
                  +{formatPi(summary.coinsEarned)} π
                </p>
              </div>
            </div>
          )}

          <div className="mt-6 inline-flex items-center gap-2 text-xs font-mono tabular-nums text-[#CBD5E1]">
            <Clock className="h-4 w-4 text-[#A855F7]" aria-hidden="true" />
            <span>Next challenge opens in {formatCountdown(msLeft)} UTC</span>
          </div>

          {!user && (
            <div className="mt-6 border-t border-white/10 pt-5">
              <p className="text-xs text-[#94A3B8] mb-3">
                Sign in with Google to permanently save quiz earnings across devices.
              </p>
              <button
                type="button"
                onClick={() => void signIn()}
                className="rounded-lg bg-[#F5B731] px-4 py-2 text-xs font-semibold text-[#07080F] hover:bg-[#F7C75C]"
              >
                Sign in with Google
              </button>
            </div>
          )}
        </section>
      </div>
    );
  }

  const runningCoins = correctCount * QUIZ_REWARD_PER_CORRECT;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header Metadata Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#0E111D] px-5 py-4">
        <div>
          <h1 className="font-display text-xl font-bold text-[#F8FAFC]">
            Daily Crypto Quiz
          </h1>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[#94A3B8] font-mono tabular-nums">
            <span>Set {dateKey}</span>
            <span aria-hidden="true">·</span>
            <span>+{QUIZ_REWARD_PER_CORRECT} π / answer</span>
            <span aria-hidden="true">·</span>
            <span>+{QUIZ_COMPLETION_BONUS} π completion bonus</span>
          </div>
        </div>

        <div className="flex items-center gap-4 font-mono tabular-nums text-xs">
          <div className="text-right">
            <span className="text-[#94A3B8]">Earned so far: </span>
            <span className="font-bold text-[#F5B731]">+{formatPi(runningCoins)} π</span>
          </div>
          <div className="flex items-center gap-1.5 text-[#CBD5E1]">
            <Clock className="h-3.5 w-3.5 text-[#A855F7]" aria-hidden="true" />
            <span>{formatCountdown(msLeft)}</span>
          </div>
        </div>
      </div>

      {/* Question Card */}
      <section className="rounded-2xl border border-white/10 bg-[#0E111D] p-6 sm:p-8">
        <div className="flex items-center justify-between gap-4 text-xs text-[#94A3B8] mb-3">
          <span className="font-mono tabular-nums">
            Question {currentIdx + 1} of {questions.length}
          </span>
          <span>{activeQuestion.topic}</span>
        </div>

        {/* Step Progress */}
        <div className="mb-6 grid grid-cols-5 gap-1.5" aria-hidden="true">
          {questions.map((q, idx) => (
            <div
              key={q.id}
              className={`h-1 rounded-full ${
                idx < currentIdx
                  ? 'bg-[#F5B731]'
                  : idx === currentIdx
                  ? 'bg-[#8B5CF6]'
                  : 'bg-white/10'
              }`}
            />
          ))}
        </div>

        <h2 className="font-display text-xl sm:text-2xl font-bold text-[#F8FAFC] leading-snug mb-6">
          {activeQuestion.question}
        </h2>

        <div className="space-y-3">
          {activeQuestion.options.map((option, idx) => {
            const isSelected = selectedIdx === idx;
            const isRightOption = idx === activeQuestion.correctIndex;

            let optionStyle =
              'border-white/12 bg-[#090B14] text-[#F8FAFC] hover:border-[#8B5CF6]/60 hover:bg-[#15192B]';
            if (hasAnswered) {
              if (isRightOption) {
                optionStyle = 'border-[#22C55E]/70 bg-[#22C55E]/12 text-[#F8FAFC]';
              } else if (isSelected) {
                optionStyle = 'border-[#EF4444]/70 bg-[#EF4444]/12 text-[#F8FAFC]';
              } else {
                optionStyle = 'border-white/8 bg-[#090B14] text-[#64748B] opacity-65';
              }
            }

            return (
              <button
                key={option}
                type="button"
                disabled={hasAnswered}
                onClick={() => handleSelectOption(idx)}
                className={`w-full min-h-[48px] flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B5CF6] ${optionStyle}`}
              >
                <span>{option}</span>
                {hasAnswered && isRightOption && (
                  <CheckCircle2 className="h-4 w-4 text-[#22C55E] shrink-0" aria-hidden="true" />
                )}
                {hasAnswered && isSelected && !isRightOption && (
                  <XCircle className="h-4 w-4 text-[#EF4444] shrink-0" aria-hidden="true" />
                )}
              </button>
            );
          })}
        </div>

        {hasAnswered && (
          <div className="mt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-t border-white/10 pt-5">
            <div className="flex items-center gap-2 text-sm font-semibold">
              {isCorrect ? (
                <span className="text-[#22C55E]">
                  Correct — +{QUIZ_REWARD_PER_CORRECT} π awarded
                </span>
              ) : (
                <span className="text-[#F87171]">
                  Incorrect — see the AI explanation below
                </span>
              )}
            </div>

            <button
              type="button"
              disabled={submitting}
              onClick={() => void handleNextOrFinish()}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#F5B731] px-5 py-2.5 text-sm font-semibold text-[#07080F] hover:bg-[#F7C75C] disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <span>
                {submitting
                  ? 'Saving...'
                  : currentIdx < questions.length - 1
                  ? 'Next Question'
                  : `Claim +${QUIZ_COMPLETION_BONUS} π Bonus`}
              </span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}
      </section>

      {/* AI Answer Panel in Quiz Mode */}
      {hasAnswered ? (
        <AiAnswerPanel
          mode="quiz"
          questionId={activeQuestion.id}
          question={activeQuestion.question}
          options={activeQuestion.options}
          correctAnswer={activeQuestion.options[activeQuestion.correctIndex]}
          selectedAnswer={activeQuestion.options[selectedIdx]}
          isCorrect={Boolean(isCorrect)}
          baseExplanation={activeQuestion.explanation}
        />
      ) : (
        <aside
          aria-label="AI answer panel preview"
          className="rounded-xl border border-[#8B5CF6]/25 bg-[#121024]/60 p-4 flex items-center gap-3 text-xs text-[#94A3B8]"
        >
          <HelpCircle className="h-4 w-4 text-[#A855F7] shrink-0" aria-hidden="true" />
          <span>
            AI-Generated Answer Panel: Select an option above to reveal an AI explanation of the concept.
          </span>
        </aside>
      )}
    </div>
  );
}
