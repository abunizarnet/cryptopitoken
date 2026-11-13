import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  doc,
  getDoc,
  increment,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  Timestamp,
  writeBatch,
} from 'firebase/firestore';
import {
  auth,
  db,
  handleFirestoreError,
  OperationType,
  signInWithGoogle,
  signOutAccount,
} from '../lib/firebase';
import {
  computeMinerStats,
  computePendingPassive,
  getUtcDateKey,
  sanitizePiHandle,
  SCHEMA_LIMITS,
  UPGRADES,
  type MinerComputedStats,
  type MinerState,
  type UpgradeId,
} from '../lib/gameConfig';

export interface PublicMinerProfile extends MinerState {
  uid: string;
  piHandle: string;
  displayName: string;
  photoUrl: string;
}

interface MinerContextValue {
  user: User | null;
  authReady: boolean;
  profileLoading: boolean;
  isSigningIn: boolean;
  authError: string | null;
  miner: MinerState;
  stats: MinerComputedStats;
  pendingPassive: number;
  piHandle: string;
  displayName: string;
  todayQuizAttempted: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  tapCoin: () => number;
  collectPassive: () => Promise<number>;
  purchaseUpgrade: (id: UpgradeId) => Promise<boolean>;
  submitDailyQuiz: (score: number, totalQuestions: number, coinsEarned: number) => Promise<void>;
  updatePiHandle: (nextHandle: string) => Promise<{ ok: boolean; error?: string }>;
  clearAuthError: () => void;
}

const GUEST_STORAGE_KEY = 'crypto_pi_guest_v1';

function createInitialState(): MinerState {
  return {
    balance: 0,
    totalMined: 0,
    tapLevel: 1,
    passiveLevel: 0,
    consensusLevel: 0,
    vaultLevel: 0,
    lastCollectAtMs: Date.now(),
    lastQuizDate: '',
  };
}

function loadGuestState(): MinerState {
  try {
    const raw = localStorage.getItem(GUEST_STORAGE_KEY);
    if (!raw) return createInitialState();
    const parsed = JSON.parse(raw) as Partial<MinerState>;
    return {
      balance: typeof parsed.balance === 'number' && parsed.balance >= 0 ? parsed.balance : 0,
      totalMined: typeof parsed.totalMined === 'number' && parsed.totalMined >= 0 ? parsed.totalMined : 0,
      tapLevel: typeof parsed.tapLevel === 'number' && parsed.tapLevel >= 1 ? Math.floor(parsed.tapLevel) : 1,
      passiveLevel: typeof parsed.passiveLevel === 'number' && parsed.passiveLevel >= 0 ? Math.floor(parsed.passiveLevel) : 0,
      consensusLevel: typeof parsed.consensusLevel === 'number' && parsed.consensusLevel >= 0 ? Math.floor(parsed.consensusLevel) : 0,
      vaultLevel: typeof parsed.vaultLevel === 'number' && parsed.vaultLevel >= 0 ? Math.floor(parsed.vaultLevel) : 0,
      lastCollectAtMs: typeof parsed.lastCollectAtMs === 'number' ? parsed.lastCollectAtMs : Date.now(),
      lastQuizDate: typeof parsed.lastQuizDate === 'string' ? parsed.lastQuizDate : '',
    };
  } catch {
    return createInitialState();
  }
}

const MinerContext = createContext<MinerContextValue | null>(null);

export function MinerProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [syncedMiner, setSyncedMiner] = useState<MinerState>(() => loadGuestState());
  const [pendingTapCoins, setPendingTapCoins] = useState(0);
  const [piHandle, setPiHandle] = useState('guest_pioneer');
  const [displayName, setDisplayName] = useState('Guest Pioneer');
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [quizCompletedDate, setQuizCompletedDate] = useState<string>('');

  const pendingTapCoinsRef = useRef(0);
  const flushTimerRef = useRef<number | null>(null);
  const userRef = useRef<User | null>(null);
  const profileReadyRef = useRef<boolean>(false);
  const syncedMinerRef = useRef<MinerState>(syncedMiner);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    syncedMinerRef.current = syncedMiner;
  }, [syncedMiner]);

  // Live passive mining tick (every 250ms)
  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 250);
    return () => window.clearInterval(interval);
  }, []);

  // Persist guest state to localStorage when signed out
  useEffect(() => {
    if (!authReady || user) return;
    const merged: MinerState = {
      ...syncedMiner,
      balance: Number((syncedMiner.balance + pendingTapCoins).toFixed(2)),
      totalMined: Number((syncedMiner.totalMined + pendingTapCoins).toFixed(2)),
    };
    try {
      localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(merged));
    } catch {
      // Ignore storage quota issues
    }
  }, [authReady, user, syncedMiner, pendingTapCoins]);

  const flushTaps = useCallback(async () => {
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const activeUser = userRef.current;
    const delta = Number(pendingTapCoinsRef.current.toFixed(2));
    if (!activeUser || !profileReadyRef.current || delta <= 0) return;

    pendingTapCoinsRef.current = 0;
    setPendingTapCoins(0);

    const path = `leaderboard/${activeUser.uid}`;
    try {
      await runTransaction(db, async (tx) => {
        const ref = doc(db, 'leaderboard', activeUser.uid);
        const snap = await tx.get(ref);
        if (!snap.exists()) return;
        const data = snap.data();
        const nextBalance = Number((Number(data.balance ?? 0) + delta).toFixed(2));
        const nextTotal = Number((Number(data.totalMined ?? 0) + delta).toFixed(2));
        tx.update(ref, {
          balance: nextBalance,
          totalMined: nextTotal,
          updatedAt: serverTimestamp(),
        });
      });
    } catch (error) {
      // Restore delta locally if write failed transiently, then surface structured error
      pendingTapCoinsRef.current = Number((pendingTapCoinsRef.current + delta).toFixed(2));
      setPendingTapCoins(pendingTapCoinsRef.current);
      setAuthError('Could not save mined coins to Firestore. Please try again.');
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }, []);

  // Flush pending taps when tab becomes hidden
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && userRef.current && pendingTapCoinsRef.current > 0) {
        void flushTaps().catch(() => undefined);
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [flushTaps]);

  // Listen to Firebase Auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      profileReadyRef.current = false;
      setUser(firebaseUser);
      setAuthReady(true);
      if (!firebaseUser) {
        setProfileLoading(false);
        setPiHandle('guest_pioneer');
        setDisplayName('Guest Pioneer');
        setQuizCompletedDate('');
        setSyncedMiner(loadGuestState());
        pendingTapCoinsRef.current = 0;
        setPendingTapCoins(0);
      }
    });
    return () => unsubscribe();
  }, []);

  // Ensure user docs exist and attach Firestore real-time listener when authenticated
  useEffect(() => {
    if (!authReady || !user) return;

    let cancelled = false;
    let unsubLeaderboard: (() => void) | null = null;
    let unsubQuizAttempt: (() => void) | null = null;

    async function initUserDocs(activeUser: User) {
      setProfileLoading(true);
      setAuthError(null);
      const userDocPath = `users/${activeUser.uid}`;
      const lbDocPath = `leaderboard/${activeUser.uid}`;
      const todayKey = getUtcDateKey();

      try {
        const userRefDoc = doc(db, 'users', activeUser.uid);
        const lbRefDoc = doc(db, 'leaderboard', activeUser.uid);

        const [userSnap, lbSnap] = await Promise.all([
          getDoc(userRefDoc).catch((err) => handleFirestoreError(err, OperationType.GET, userDocPath)),
          getDoc(lbRefDoc).catch((err) => handleFirestoreError(err, OperationType.GET, lbDocPath)),
        ]);

        if (cancelled) return;

        const cleanName = (
          activeUser.displayName?.trim() ||
          activeUser.email?.split('@')[0]?.trim() ||
          'Pioneer'
        ).slice(0, SCHEMA_LIMITS.DISPLAY_NAME_MAX);

        const cleanEmail = (activeUser.email || `${activeUser.uid}@pi.local`).slice(0, 254);
        const defaultHandle = sanitizePiHandle(
          activeUser.email?.split('@')[0] || cleanName,
          activeUser.uid
        );
        const cleanPhoto = (activeUser.photoURL || '').slice(0, SCHEMA_LIMITS.PHOTO_URL_MAX);

        if (!userSnap.exists() || !lbSnap.exists()) {
          const batch = writeBatch(db);
          const guest = loadGuestState();

          if (!userSnap.exists()) {
            batch.set(userRefDoc, {
              uid: activeUser.uid,
              email: cleanEmail,
              displayName: cleanName,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }

          if (!lbSnap.exists()) {
            batch.set(lbRefDoc, {
              uid: activeUser.uid,
              piHandle: defaultHandle,
              displayName: cleanName,
              photoUrl: cleanPhoto,
              isPublic: true,
              balance: Number(guest.balance.toFixed(2)),
              totalMined: Number(guest.totalMined.toFixed(2)),
              tapLevel: Math.max(1, guest.tapLevel),
              passiveLevel: Math.max(0, guest.passiveLevel),
              consensusLevel: Math.max(0, guest.consensusLevel),
              vaultLevel: Math.max(0, guest.vaultLevel),
              lastCollectAt: serverTimestamp(),
              lastQuizDate: '',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }

          await batch.commit().catch((err) =>
            handleFirestoreError(err, OperationType.WRITE, `${userDocPath} & ${lbDocPath}`)
          );
          try {
            localStorage.removeItem(GUEST_STORAGE_KEY);
          } catch {
            // ignore
          }
        }

        if (cancelled) return;
        profileReadyRef.current = true;

        unsubLeaderboard = onSnapshot(
          lbRefDoc,
          (snap) => {
            if (!snap.exists()) return;
            const data = snap.data();
            const collectTs = data.lastCollectAt as Timestamp | null | undefined;
            const collectMs = collectTs ? collectTs.toMillis() : Date.now();

            setPiHandle(String(data.piHandle || defaultHandle));
            setDisplayName(String(data.displayName || cleanName));
            setSyncedMiner({
              balance: Number(data.balance ?? 0),
              totalMined: Number(data.totalMined ?? 0),
              tapLevel: Number(data.tapLevel ?? 1),
              passiveLevel: Number(data.passiveLevel ?? 0),
              consensusLevel: Number(data.consensusLevel ?? 0),
              vaultLevel: Number(data.vaultLevel ?? 0),
              lastCollectAtMs: collectMs,
              lastQuizDate: String(data.lastQuizDate ?? ''),
            });
            setProfileLoading(false);
          },
          (error) => {
            setProfileLoading(false);
            handleFirestoreError(error, OperationType.GET, lbDocPath);
          }
        );

        const quizPath = `users/${activeUser.uid}/quiz_attempts/${todayKey}`;
        unsubQuizAttempt = onSnapshot(
          doc(db, 'users', activeUser.uid, 'quiz_attempts', todayKey),
          (snap) => {
            if (snap.exists()) {
              setQuizCompletedDate(todayKey);
            }
          },
          (error) => {
            handleFirestoreError(error, OperationType.GET, quizPath);
          }
        );

        if (pendingTapCoinsRef.current > 0) {
          void flushTaps().catch(() => undefined);
        }
      } catch (err) {
        if (!cancelled) {
          setProfileLoading(false);
          setAuthError(
            err instanceof Error ? err.message : 'Unable to sync your Pi profile with Firestore.'
          );
        }
      }
    }

    void initUserDocs(user);

    return () => {
      cancelled = true;
      profileReadyRef.current = false;
      unsubLeaderboard?.();
      unsubQuizAttempt?.();
    };
  }, [authReady, user, flushTaps]);

  const miner = useMemo<MinerState>(() => {
    return {
      ...syncedMiner,
      balance: Number((syncedMiner.balance + pendingTapCoins).toFixed(2)),
      totalMined: Number((syncedMiner.totalMined + pendingTapCoins).toFixed(2)),
    };
  }, [syncedMiner, pendingTapCoins]);

  const stats = useMemo(() => computeMinerStats(miner), [miner]);
  const pendingPassive = useMemo(() => computePendingPassive(miner, nowMs), [miner, nowMs]);

  const signIn = useCallback(async () => {
    setAuthError(null);
    setIsSigningIn(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign-in cancelled or blocked.';
      setAuthError(message);
    } finally {
      setIsSigningIn(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    if (pendingTapCoinsRef.current > 0) {
      await flushTaps().catch(() => undefined);
    }
    await signOutAccount();
  }, [flushTaps]);

  const tapCoin = useCallback(() => {
    const gain = computeMinerStats(syncedMinerRef.current).tapValue;

    if (!userRef.current) {
      setSyncedMiner((prev) => ({
        ...prev,
        balance: Number((prev.balance + gain).toFixed(2)),
        totalMined: Number((prev.totalMined + gain).toFixed(2)),
      }));
      return gain;
    }

    pendingTapCoinsRef.current = Number((pendingTapCoinsRef.current + gain).toFixed(2));
    setPendingTapCoins(pendingTapCoinsRef.current);

    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
    }
    flushTimerRef.current = window.setTimeout(() => {
      void flushTaps().catch(() => undefined);
    }, 800);

    return gain;
  }, [flushTaps]);

  const collectPassive = useCallback(async () => {
    const currentNow = Date.now();
    const collected = computePendingPassive(syncedMinerRef.current, currentNow);
    if (collected < 0.01) return 0;

    if (!userRef.current) {
      setSyncedMiner((prev) => ({
        ...prev,
        balance: Number((prev.balance + collected).toFixed(2)),
        totalMined: Number((prev.totalMined + collected).toFixed(2)),
        lastCollectAtMs: currentNow,
      }));
      return collected;
    }

    await flushTaps();
    const uid = userRef.current.uid;
    const path = `leaderboard/${uid}`;

    try {
      await runTransaction(db, async (tx) => {
        const ref = doc(db, 'leaderboard', uid);
        const snap = await tx.get(ref);
        if (!snap.exists()) return;
        const data = snap.data();
        const ts = data.lastCollectAt as Timestamp | undefined;
        const freshState: MinerState = {
          balance: Number(data.balance ?? 0),
          totalMined: Number(data.totalMined ?? 0),
          tapLevel: Number(data.tapLevel ?? 1),
          passiveLevel: Number(data.passiveLevel ?? 0),
          consensusLevel: Number(data.consensusLevel ?? 0),
          vaultLevel: Number(data.vaultLevel ?? 0),
          lastCollectAtMs: ts ? ts.toMillis() : currentNow,
          lastQuizDate: String(data.lastQuizDate ?? ''),
        };
        const freshPending = computePendingPassive(freshState, Date.now());
        if (freshPending < 0.01) return;

        tx.update(ref, {
          balance: Number((freshState.balance + freshPending).toFixed(2)),
          totalMined: Number((freshState.totalMined + freshPending).toFixed(2)),
          lastCollectAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }

    return collected;
  }, [flushTaps]);

  const purchaseUpgrade = useCallback(
    async (id: UpgradeId) => {
      const def = UPGRADES.find((u) => u.id === id);
      if (!def) return false;

      if (!userRef.current) {
        let bought = false;
        setSyncedMiner((prev) => {
          const level = def.getLevel(prev);
          if (level >= def.maxLevel) return prev;
          const cost = def.getCost(level);
          if (prev.balance < cost) return prev;
          bought = true;
          const next = def.applyUpgrade(prev);
          return {
            ...next,
            balance: Number((prev.balance - cost).toFixed(2)),
          };
        });
        return bought;
      }

      await flushTaps();
      const uid = userRef.current.uid;
      const path = `leaderboard/${uid}`;
      let purchased = false;

      try {
        await runTransaction(db, async (tx) => {
          const ref = doc(db, 'leaderboard', uid);
          const snap = await tx.get(ref);
          if (!snap.exists()) return;
          const data = snap.data();
          const currentState: MinerState = {
            balance: Number(data.balance ?? 0),
            totalMined: Number(data.totalMined ?? 0),
            tapLevel: Number(data.tapLevel ?? 1),
            passiveLevel: Number(data.passiveLevel ?? 0),
            consensusLevel: Number(data.consensusLevel ?? 0),
            vaultLevel: Number(data.vaultLevel ?? 0),
            lastCollectAtMs: Date.now(),
            lastQuizDate: String(data.lastQuizDate ?? ''),
          };

          const level = def.getLevel(currentState);
          if (level >= def.maxLevel) return;
          const cost = def.getCost(level);
          if (currentState.balance < cost) return;

          const upgraded = def.applyUpgrade(currentState);
          purchased = true;

          tx.update(ref, {
            balance: Number((currentState.balance - cost).toFixed(2)),
            tapLevel: upgraded.tapLevel,
            passiveLevel: upgraded.passiveLevel,
            consensusLevel: upgraded.consensusLevel,
            vaultLevel: upgraded.vaultLevel,
            updatedAt: serverTimestamp(),
          });
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, path);
      }

      return purchased;
    },
    [flushTaps]
  );

  const submitDailyQuiz = useCallback(
    async (score: number, totalQuestions: number, coinsEarned: number) => {
      const dateKey = getUtcDateKey();

      if (!userRef.current) {
        setSyncedMiner((prev) => ({
          ...prev,
          balance: Number((prev.balance + coinsEarned).toFixed(2)),
          totalMined: Number((prev.totalMined + coinsEarned).toFixed(2)),
          lastQuizDate: dateKey,
        }));
        setQuizCompletedDate(dateKey);
        return;
      }

      await flushTaps();
      const uid = userRef.current.uid;
      const attemptRef = doc(db, 'users', uid, 'quiz_attempts', dateKey);
      const lbRef = doc(db, 'leaderboard', uid);
      const batchPath = `users/${uid}/quiz_attempts/${dateKey}`;

      try {
        const batch = writeBatch(db);
        batch.set(attemptRef, {
          uid,
          dateKey,
          score,
          totalQuestions,
          coinsEarned,
          status: 'completed',
          createdAt: serverTimestamp(),
        });
        batch.update(lbRef, {
          balance: increment(coinsEarned),
          totalMined: increment(coinsEarned),
          lastQuizDate: dateKey,
          updatedAt: serverTimestamp(),
        });
        await batch.commit();
        setQuizCompletedDate(dateKey);
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, batchPath);
      }
    },
    [flushTaps]
  );

  const updatePiHandle = useCallback(
    async (nextHandle: string): Promise<{ ok: boolean; error?: string }> => {
      const trimmed = nextHandle.trim();
      if (
        trimmed.length < SCHEMA_LIMITS.PI_HANDLE_MIN ||
        trimmed.length > SCHEMA_LIMITS.PI_HANDLE_MAX ||
        !SCHEMA_LIMITS.PI_HANDLE_REGEX.test(trimmed)
      ) {
        return {
          ok: false,
          error: 'Handle must be 2–32 characters using letters, numbers, "_", ".", or "-".',
        };
      }

      if (!userRef.current) {
        setPiHandle(trimmed);
        return { ok: true };
      }

      const uid = userRef.current.uid;
      const path = `leaderboard/${uid}`;
      try {
        await runTransaction(db, async (tx) => {
          const ref = doc(db, 'leaderboard', uid);
          const snap = await tx.get(ref);
          if (!snap.exists()) return;
          tx.update(ref, {
            piHandle: trimmed,
            updatedAt: serverTimestamp(),
          });
        });
        return { ok: true };
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, path);
      }
    },
    []
  );

  const todayKey = getUtcDateKey(new Date(nowMs));
  const todayQuizAttempted =
    miner.lastQuizDate === todayKey || quizCompletedDate === todayKey;

  const clearAuthError = useCallback(() => setAuthError(null), []);

  const value = useMemo<MinerContextValue>(
    () => ({
      user,
      authReady,
      profileLoading,
      isSigningIn,
      authError,
      miner,
      stats,
      pendingPassive,
      piHandle,
      displayName,
      todayQuizAttempted,
      signIn,
      signOut,
      tapCoin,
      collectPassive,
      purchaseUpgrade,
      submitDailyQuiz,
      updatePiHandle,
      clearAuthError,
    }),
    [
      user,
      authReady,
      profileLoading,
      isSigningIn,
      authError,
      miner,
      stats,
      pendingPassive,
      piHandle,
      displayName,
      todayQuizAttempted,
      signIn,
      signOut,
      tapCoin,
      collectPassive,
      purchaseUpgrade,
      submitDailyQuiz,
      updatePiHandle,
      clearAuthError,
    ]
  );

  return <MinerContext.Provider value={value}>{children}</MinerContext.Provider>;
}

export function useMiner(): MinerContextValue {
  const ctx = useContext(MinerContext);
  if (!ctx) {
    throw new Error('useMiner must be used inside MinerProvider');
  }
  return ctx;
}
