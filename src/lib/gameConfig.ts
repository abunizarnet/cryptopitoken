export type UpgradeId = 'tap' | 'passive' | 'consensus' | 'vault';

export interface MinerState {
  balance: number;
  totalMined: number;
  tapLevel: number;
  passiveLevel: number;
  consensusLevel: number;
  vaultLevel: number;
  lastCollectAtMs: number;
  lastQuizDate: string;
}

export interface MinerComputedStats {
  tapValue: number;
  passiveRate: number;
  vaultHours: number;
  maxVaultCoins: number;
}

export interface UpgradeDefinition {
  id: UpgradeId;
  name: string;
  summary: string;
  maxLevel: number;
  getLevel: (s: MinerState) => number;
  getCost: (level: number) => number;
  formatEffect: (s: MinerState) => { current: string; next: string };
  applyUpgrade: (s: MinerState) => MinerState;
}

// Validation constants synchronized verbatim with firebase-blueprint.json
export const SCHEMA_LIMITS = {
  PI_HANDLE_MIN: 2,
  PI_HANDLE_MAX: 32,
  PI_HANDLE_REGEX: /^[a-zA-Z0-9_.-]+$/,
  DISPLAY_NAME_MIN: 1,
  DISPLAY_NAME_MAX: 64,
  PHOTO_URL_MAX: 512,
  MAX_LEVEL: 1000,
} as const;

export function sanitizePiHandle(raw: string, fallbackSuffix: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, SCHEMA_LIMITS.PI_HANDLE_MAX);
  if (cleaned.length >= SCHEMA_LIMITS.PI_HANDLE_MIN) {
    return cleaned;
  }
  return `pioneer_${fallbackSuffix.slice(0, 6)}`.slice(0, SCHEMA_LIMITS.PI_HANDLE_MAX);
}

export function computeMinerStats(state: MinerState): MinerComputedStats {
  const baseTap = state.tapLevel + state.vaultLevel * 2;
  const tapMultiplier = 1 + state.consensusLevel * 0.15;
  const tapValue = Number((baseTap * tapMultiplier).toFixed(2));

  const basePassive = state.passiveLevel * 0.5 + state.vaultLevel * 1.5;
  const passiveMultiplier = 1 + state.consensusLevel * 0.12;
  const passiveRate = Number((basePassive * passiveMultiplier).toFixed(2));

  const vaultHours = 4 + state.vaultLevel * 2;
  const maxVaultCoins = Number((passiveRate * vaultHours * 3600).toFixed(2));

  return {
    tapValue,
    passiveRate,
    vaultHours,
    maxVaultCoins,
  };
}

export function computePendingPassive(state: MinerState, nowMs: number): number {
  const { passiveRate, maxVaultCoins } = computeMinerStats(state);
  if (passiveRate <= 0 || maxVaultCoins <= 0) return 0;
  const elapsedSec = Math.max(0, (nowMs - state.lastCollectAtMs) / 1000);
  const raw = elapsedSec * passiveRate;
  return Number(Math.min(raw, maxVaultCoins).toFixed(2));
}

export const UPGRADES: UpgradeDefinition[] = [
  {
    id: 'tap',
    name: 'Quantum Tap Core',
    summary: 'Boosts base Pi coins earned on every coin tap.',
    maxLevel: SCHEMA_LIMITS.MAX_LEVEL,
    getLevel: (s) => s.tapLevel,
    getCost: (level) => Math.floor(25 * Math.pow(1.45, Math.max(0, level - 1))),
    formatEffect: (s) => {
      const nowStats = computeMinerStats(s);
      const nextStats = computeMinerStats({ ...s, tapLevel: s.tapLevel + 1 });
      return {
        current: `${nowStats.tapValue.toFixed(1)} π/tap`,
        next: `${nextStats.tapValue.toFixed(1)} π/tap`,
      };
    },
    applyUpgrade: (s) => ({ ...s, tapLevel: s.tapLevel + 1 }),
  },
  {
    id: 'passive',
    name: 'Node Validator Rig',
    summary: 'Mines Pi coins continuously into your node vault.',
    maxLevel: SCHEMA_LIMITS.MAX_LEVEL,
    getLevel: (s) => s.passiveLevel,
    getCost: (level) => Math.floor(40 * Math.pow(1.48, level)),
    formatEffect: (s) => {
      const nowStats = computeMinerStats(s);
      const nextStats = computeMinerStats({ ...s, passiveLevel: s.passiveLevel + 1 });
      return {
        current: `${nowStats.passiveRate.toFixed(2)} π/s`,
        next: `${nextStats.passiveRate.toFixed(2)} π/s`,
      };
    },
    applyUpgrade: (s) => ({ ...s, passiveLevel: s.passiveLevel + 1 }),
  },
  {
    id: 'consensus',
    name: 'Mainnet Consensus Boost',
    summary: 'Multiplies both tap yield (+15%) and passive rate (+12%).',
    maxLevel: SCHEMA_LIMITS.MAX_LEVEL,
    getLevel: (s) => s.consensusLevel,
    getCost: (level) => Math.floor(150 * Math.pow(1.62, level)),
    formatEffect: (s) => {
      const nowStats = computeMinerStats(s);
      const nextStats = computeMinerStats({ ...s, consensusLevel: s.consensusLevel + 1 });
      return {
        current: `${nowStats.tapValue.toFixed(1)} tap · ${nowStats.passiveRate.toFixed(2)}/s`,
        next: `${nextStats.tapValue.toFixed(1)} tap · ${nextStats.passiveRate.toFixed(2)}/s`,
      };
    },
    applyUpgrade: (s) => ({ ...s, consensusLevel: s.consensusLevel + 1 }),
  },
  {
    id: 'vault',
    name: 'Pi Vault Overclock',
    summary: 'Extends offline vault capacity by +2h and adds +2 base tap & +1.5/s.',
    maxLevel: SCHEMA_LIMITS.MAX_LEVEL,
    getLevel: (s) => s.vaultLevel,
    getCost: (level) => Math.floor(240 * Math.pow(1.65, level)),
    formatEffect: (s) => {
      const nowStats = computeMinerStats(s);
      const nextStats = computeMinerStats({ ...s, vaultLevel: s.vaultLevel + 1 });
      return {
        current: `${nowStats.vaultHours}h vault · ${nowStats.passiveRate.toFixed(2)}/s`,
        next: `${nextStats.vaultHours}h vault · ${nextStats.passiveRate.toFixed(2)}/s`,
      };
    },
    applyUpgrade: (s) => ({ ...s, vaultLevel: s.vaultLevel + 1 }),
  },
];

export function formatPi(value: number): string {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)}B`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  return value.toLocaleString('en-US', {
    minimumFractionDigits: value < 100 && value % 1 !== 0 ? 1 : 0,
    maximumFractionDigits: 1,
  });
}

export interface QuizQuestion {
  id: string;
  topic: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export const QUIZ_REWARD_PER_CORRECT = 150;
export const QUIZ_COMPLETION_BONUS = 500;
export const DAILY_QUIZ_COUNT = 5;

const QUIZ_BANK: QuizQuestion[] = [
  {
    id: 'pi-consensus',
    topic: 'Pi Network',
    question: 'Which consensus protocol underpins the Pi Network blockchain instead of energy-heavy Proof of Work?',
    options: [
      'Stellar Consensus Protocol (SCP)',
      'SHA-256 Proof of Work',
      'Delegated Proof of Burn',
      'Proof of Elapsed Time',
    ],
    correctIndex: 0,
    explanation:
      'Pi Network adapts the Stellar Consensus Protocol (SCP), where nodes form trusted quorum slices to validate transactions without massive electricity consumption.',
  },
  {
    id: 'security-circle',
    topic: 'Pi Ecosystem',
    question: 'What is the primary purpose of a Pioneer’s Security Circle in the Pi Network?',
    options: [
      'To build a global trust graph that helps verify legitimate nodes',
      'To store raw private keys on a shared cloud server',
      'To increase transaction gas fees during peak hours',
      'To mint duplicate blocks on Bitcoin',
    ],
    correctIndex: 0,
    explanation:
      'Security Circles connect trusted Pioneers into an aggregate trust graph that informs quorum slices and defends the network against Sybil attacks.',
  },
  {
    id: 'seed-phrase',
    topic: 'Wallets',
    question: 'What happens if you lose your 24-word non-custodial wallet passphrase without a backup?',
    options: [
      'No central support team can recover access to the wallet',
      'Customer support can reset it via SMS verification',
      'Your tokens automatically transfer to your email address',
      'The blockchain re-issues a new passphrase after 30 days',
    ],
    correctIndex: 0,
    explanation:
      'In a non-custodial wallet, your 24-word mnemonic phrase is the sole cryptographic root of your private keys, so nobody else can reset or recover it.',
  },
  {
    id: 'public-vs-private',
    topic: 'Wallets',
    question: 'Which piece of wallet information is safe to share publicly so others can send you tokens?',
    options: [
      'Your public wallet address',
      'Your 24-word recovery passphrase',
      'Your raw private signing key',
      'Your hardware wallet PIN and seed words',
    ],
    correctIndex: 0,
    explanation:
      'A public address works like a mailbox slot that lets anyone send funds to you, whereas private keys and seed phrases authorize spending and must stay secret.',
  },
  {
    id: 'block-hash',
    topic: 'Blocks',
    question: 'How does each new block in a blockchain stay tamper-resistant relative to earlier blocks?',
    options: [
      'It embeds the cryptographic hash of the previous block header',
      'It compresses all user passwords into a JPEG file',
      'It deletes old transactions once a block is finalized',
      'It relies on a single administrator approving edits',
    ],
    correctIndex: 0,
    explanation:
      'Linking each block to the previous block’s hash creates an immutable chain: altering any past transaction invalidates every subsequent block hash.',
  },
  {
    id: 'mainnet-vs-testnet',
    topic: 'Pi Mainnet',
    question: 'What distinguishes a blockchain’s Mainnet from its Testnet?',
    options: [
      'Mainnet carries real, persistent value and live production state',
      'Testnet transactions cannot be inspected on a block explorer',
      'Mainnet requires zero cryptographic signatures',
      'Testnet runs only on offline spreadsheets',
    ],
    correctIndex: 0,
    explanation:
      'Testnet is a sandbox using valueless test tokens for experimentation, while Mainnet is the live production ledger where real assets and smart contracts operate.',
  },
  {
    id: 'kyc-migration',
    topic: 'Pi Ecosystem',
    question: 'Why does Pi Network require KYC verification before migrating mined balances to Open Mainnet?',
    options: [
      'To ensure one-account-per-person fairness and prevent bot farms',
      'To publish every user’s government ID publicly on-chain',
      'To charge monthly subscription fees to validators',
      'To convert Pi into a centralized database table',
    ],
    correctIndex: 0,
    explanation:
      'KYC protects the network from fake accounts and automated Sybil farms so real Pioneers receive fair ownership on Mainnet.',
  },
  {
    id: 'gas-fee',
    topic: 'Transactions',
    question: 'Why do public blockchains charge a small transaction fee (gas) when submitting state changes?',
    options: [
      'To compensate validators and prevent network spam attacks',
      'To pay internet browser companies for rendering HTML',
      'To randomly erase older wallet balances',
      'To hide transaction timestamps from the ledger',
    ],
    correctIndex: 0,
    explanation:
      'Transaction fees reward network validators for processing blocks and create an economic barrier against spamming the ledger with infinite transactions.',
  },
  {
    id: 'node-role',
    topic: 'Mining & Nodes',
    question: 'What is the main responsibility of a validator node on a decentralized ledger?',
    options: [
      'Verifying transaction signatures and agreeing on block order',
      'Storing user email passwords in plaintext',
      'Manually editing user balances upon request',
      'Shutting down peer-to-peer connections',
    ],
    correctIndex: 0,
    explanation:
      'Validator nodes check cryptographic signatures, enforce protocol rules, and run consensus to agree on the canonical order of transactions.',
  },
  {
    id: 'smart-contract',
    topic: 'Blockchain Basics',
    question: 'What makes a smart contract different from a traditional server script?',
    options: [
      'Its code executes deterministically across decentralized nodes on-chain',
      'It can only run when a company CEO logs in manually',
      'It hides all execution outcomes from verification',
      'It runs exclusively inside a browser CSS stylesheet',
    ],
    correctIndex: 0,
    explanation:
      'Smart contracts are deterministic programs deployed to a blockchain, meaning every validating node verifies the same inputs and state transitions.',
  },
  {
    id: 'custodial-risk',
    topic: 'Security',
    question: 'What does the crypto phrase "Not your keys, not your coins" refer to?',
    options: [
      'Holding tokens on a centralized platform means relying on that custodian',
      'Physical metal coins are heavier than digital tokens',
      'Public addresses should be changed every ten seconds',
      'Mining rewards expire unless spent daily',
    ],
    correctIndex: 0,
    explanation:
      'When an exchange holds your private keys, you hold an IOU from that company rather than direct cryptographic control over the assets on-chain.',
  },
  {
    id: 'halving-supply',
    topic: 'Tokenomics',
    question: 'Why do many cryptocurrencies reduce their base mining issuance rate over time?',
    options: [
      'To enforce predictable scarcity and curb runaway inflation',
      'To make wallets incompatible with older addresses',
      'To force miners to delete their transaction history',
      'To disable peer-to-peer transfers after launch',
    ],
    correctIndex: 0,
    explanation:
      'Scheduled issuance reductions create a transparent supply curve, rewarding early network contributors while preventing unbounded token dilution.',
  },
  {
    id: 'merkle-tree',
    topic: 'Blocks',
    question: 'How do Merkle trees help blockchain light clients verify transactions efficiently?',
    options: [
      'They allow proving a transaction is in a block using compact hash paths',
      'They encrypt every image attached to a webpage',
      'They replace all public addresses with phone numbers',
      'They double the size of every block header',
    ],
    correctIndex: 0,
    explanation:
      'A Merkle root summarizes all transactions in a block into one hash, letting light clients verify inclusion with only a logarithmic proof path.',
  },
  {
    id: 'multisig',
    topic: 'Wallets',
    question: 'What is a multi-signature (multisig) wallet used for?',
    options: [
      'Requiring M-of-N distinct keys to authorize a transaction',
      'Mining blocks twice as fast on a single laptop',
      'Bypassing blockchain consensus rules',
      'Sharing one password across an entire forum',
    ],
    correctIndex: 0,
    explanation:
      'Multisig eliminates single points of failure by requiring multiple independent signers—such as 2-of-3 keys—to approve moving treasury funds.',
  },
  {
    id: 'phishing-defense',
    topic: 'Security',
    question: 'Which action is the safest way to verify a Pi ecosystem dApp before signing a transaction?',
    options: [
      'Check the exact domain URL and never enter your 24-word passphrase on unknown sites',
      'Paste your passphrase into any popup promising bonus airdrops',
      'Disable wallet confirmation prompts permanently',
      'Share your seed words with a moderator in direct messages',
    ],
    correctIndex: 0,
    explanation:
      'Legitimate dApps only request transaction signatures through your trusted wallet interface—they never ask you to type your 24-word passphrase into a web form.',
  },
];

export function getUtcDateKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function getMsUntilNextUtcMidnight(now: Date = new Date()): number {
  const nextMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0,
    0
  );
  return Math.max(0, nextMidnight - now.getTime());
}

export function formatCountdown(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  return [hours, minutes, seconds].map((n) => String(n).padStart(2, '0')).join(':');
}

export function getDailyQuizQuestions(dateKey: string): QuizQuestion[] {
  // Deterministic seeded shuffle based on YYYY-MM-DD so all Pioneers share today's daily challenge
  let seed = 0;
  for (let i = 0; i < dateKey.length; i += 1) {
    seed = (seed * 31 + dateKey.charCodeAt(i)) >>> 0;
  }

  const copy = [...QUIZ_BANK];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }

  return copy.slice(0, DAILY_QUIZ_COUNT);
}
