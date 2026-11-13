import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const isProduction = process.env.NODE_ENV === 'production';

function createAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

interface MinerExplainPayload {
  mode: 'miner';
  balance: number;
  totalMined: number;
  tapValue: number;
  passiveRate: number;
  tapLevel: number;
  passiveLevel: number;
  consensusLevel: number;
  vaultLevel: number;
  nextUpgradeName?: string;
  nextUpgradeCost?: number;
  nextUpgradeEffect?: string;
}

interface QuizExplainPayload {
  mode: 'quiz';
  question: string;
  options: string[];
  correctAnswer: string;
  selectedAnswer: string;
  isCorrect: boolean;
  baseExplanation: string;
}

type ExplainPayload = MinerExplainPayload | QuizExplainPayload;

function buildFallbackExplanation(payload: ExplainPayload): string {
  if (payload.mode === 'miner') {
    const tapDesc = `Your Quantum Tap Core (Lv.${payload.tapLevel}) combined with Mainnet Consensus Boost (Lv.${payload.consensusLevel}) yields ${payload.tapValue.toFixed(1)} π per tap.`;
    const passiveDesc =
      payload.passiveRate > 0
        ? `Your Node Validator Rig (Lv.${payload.passiveLevel}) and Pi Vault Overclock (Lv.${payload.vaultLevel}) mine ${payload.passiveRate.toFixed(2)} π/sec passively.`
        : 'You have not activated passive node mining yet—purchasing Node Validator Rig Lv.1 will start generating π continuously even when idle.';
    const nextDesc = payload.nextUpgradeName
      ? `Next recommended upgrade: ${payload.nextUpgradeName} (${payload.nextUpgradeEffect}) for ${Math.ceil(payload.nextUpgradeCost ?? 0).toLocaleString()} π.`
      : '';
    return `${tapDesc} ${passiveDesc} ${nextDesc}`.trim();
  }

  return payload.baseExplanation;
}

const explanationCache = new Map<string, { explanation: string; expiresAt: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000;
let geminiCooldownUntil = 0;

function getCacheKey(payload: ExplainPayload, force?: boolean): string {
  if (force) return '';
  if (payload.mode === 'miner') {
    return `miner:${payload.tapLevel}:${payload.passiveLevel}:${payload.consensusLevel}:${payload.vaultLevel}:${payload.nextUpgradeName ?? ''}`;
  }
  return `quiz:${payload.question}:${payload.isCorrect}:${payload.selectedAnswer}`;
}

function isQuotaError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.toLowerCase().includes('quota');
}

async function generateWithFallbackModel(
  ai: GoogleGenAI,
  prompt: string,
  systemInstruction: string
): Promise<string | null> {
  const models: Array<{ model: string; useThinking: boolean }> = [
    { model: 'gemini-4-hydrogen', useThinking: true },
    { model: 'gemini-3.1-flash-lite', useThinking: false },
  ];

  for (const candidate of models) {
    try {
      const response = await ai.models.generateContent({
        model: candidate.model,
        contents: prompt,
        config: {
          ...(candidate.useThinking
            ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
            : {}),
          systemInstruction,
        },
      });
      const text = response.text?.trim();
      if (text) return text;
    } catch (err) {
      if (isQuotaError(err)) {
        continue;
      }
      throw err;
    }
  }
  return null;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  app.get('/validation-key.txt', async (_req: Request, res: Response) => {
    const envKey = process.env.PI_VALIDATION_KEY?.trim();
    if (envKey && envKey !== 'MY_PI_VALIDATION_KEY') {
      res.type('text/plain; charset=utf-8').send(envKey);
      return;
    }

    const candidates = [
      path.join(__dirname, 'public', 'validation-key.txt'),
      path.join(__dirname, 'dist', 'validation-key.txt'),
    ];
    for (const filePath of candidates) {
      try {
        const content = await fs.readFile(filePath, 'utf8');
        res.type('text/plain; charset=utf-8').send(content.trim());
        return;
      } catch {
        // try next candidate
      }
    }
    res.status(404).type('text/plain').send('validation-key.txt not configured');
  });

  app.post('/api/pi/verify', async (req: Request, res: Response) => {
    const { accessToken } = req.body as { accessToken?: string };
    if (!accessToken || typeof accessToken !== 'string') {
      res.status(400).json({ error: 'Missing Pi accessToken' });
      return;
    }

    try {
      const piRes = await fetch('https://api.minepi.com/v2/me', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      if (!piRes.ok) {
        res.status(piRes.status).json({ verified: false, error: 'Pi token verification failed' });
        return;
      }
      const piUser = (await piRes.json()) as { uid?: string; username?: string };
      res.json({
        verified: true,
        uid: piUser.uid,
        username: piUser.username,
      });
    } catch (error) {
      console.error('Pi verification error:', error);
      res.status(502).json({ verified: false, error: 'Unable to reach Pi Platform API' });
    }
  });

  app.post('/api/ai/explain', async (req: Request, res: Response) => {
    const payload = req.body as ExplainPayload & { force?: boolean };
    if (!payload || (payload.mode !== 'miner' && payload.mode !== 'quiz')) {
      res.status(400).json({ error: 'Invalid explanation mode' });
      return;
    }

    const cacheKey = getCacheKey(payload, payload.force);
    if (cacheKey) {
      const cached = explanationCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        res.json({
          explanation: cached.explanation,
          source: 'gemini',
        });
        return;
      }
    }

    const ai = createAiClient();
    if (!ai || Date.now() < geminiCooldownUntil) {
      res.json({
        explanation: buildFallbackExplanation(payload),
        source: 'local',
      });
      return;
    }

    try {
      const prompt =
        payload.mode === 'miner'
          ? [
              'You are the in-app crypto miner strategist inside the Crypto Pi Token game.',
              'Explain the player’s current earning setup in 2-3 clear, plain-language sentences (no markdown headers, no bullet points, no hype).',
              'Specifically explain: (1) why their tap value and passive mining rate are at their current values based on upgrade levels, and (2) what their next upgrade will change.',
              `Current stats: balance=${payload.balance.toFixed(1)} π, totalMined=${payload.totalMined.toFixed(1)} π, tapValue=${payload.tapValue.toFixed(2)} π/tap, passiveRate=${payload.passiveRate.toFixed(2)} π/sec.`,
              `Upgrade levels: Quantum Tap Core Lv.${payload.tapLevel}, Node Validator Rig Lv.${payload.passiveLevel}, Mainnet Consensus Boost Lv.${payload.consensusLevel}, Pi Vault Overclock Lv.${payload.vaultLevel}.`,
              payload.nextUpgradeName
                ? `Next highlighted upgrade: ${payload.nextUpgradeName} costing ${Math.ceil(payload.nextUpgradeCost ?? 0)} π (${payload.nextUpgradeEffect}).`
                : '',
            ]
              .filter(Boolean)
              .join('\n')
          : [
              'You are a concise blockchain educator inside the Crypto Pi Token daily quiz.',
              'Give a crisp 2-sentence plain-language explanation of why the correct answer is right and how it relates to crypto or Pi Network concepts. Do not use markdown headers or bullet lists.',
              `Question: ${payload.question}`,
              `Player answered: ${payload.selectedAnswer} (${payload.isCorrect ? 'Correct' : 'Incorrect'})`,
              `Correct answer: ${payload.correctAnswer}`,
              `Reference concept: ${payload.baseExplanation}`,
            ].join('\n');

      const text = await generateWithFallbackModel(
        ai,
        prompt,
        'Keep answers accurate, friendly, concise (40-75 words), and strictly plain text without markdown formatting.'
      );

      if (!text) {
        geminiCooldownUntil = Date.now() + 10 * 60 * 1000;
        console.warn('Gemini free-tier quota reached; using local explanation fallback for 10m.');
        res.json({
          explanation: buildFallbackExplanation(payload),
          source: 'local',
        });
        return;
      }

      if (cacheKey) {
        if (explanationCache.size >= 500) {
          const oldest = explanationCache.keys().next().value;
          if (oldest) explanationCache.delete(oldest);
        }
        explanationCache.set(cacheKey, {
          explanation: text,
          expiresAt: Date.now() + CACHE_TTL_MS,
        });
      }

      res.json({
        explanation: text,
        source: 'gemini',
      });
    } catch (error) {
      if (isQuotaError(error)) {
        geminiCooldownUntil = Date.now() + 10 * 60 * 1000;
        console.warn('Gemini quota exceeded; serving local explanation fallback.');
      } else {
        console.warn('Gemini explanation unavailable; serving local fallback.');
      }
      res.json({
        explanation: buildFallbackExplanation(payload),
        source: 'local',
      });
    }
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Crypto Pi Token server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
