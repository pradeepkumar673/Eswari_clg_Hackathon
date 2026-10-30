/**
 * apps/api/src/llm/provider.ts
 *
 * Groq LLM wrapper with SHA-256 input-hash caching in llm_cache.
 * If GROQ_API_KEY is unset or unavailable, throws a typed LLMUnavailable error.
 * The application has 100% functional fallback to deterministic rule-based logic.
 */

import crypto from 'node:crypto';
import { LlmCache } from '../models/llm-cache.js';
import { config } from '../config.js';

export class LLMUnavailable extends Error {
  public readonly code = 'LLM_UNAVAILABLE';
  constructor(message = 'LLM service is not configured or unavailable') {
    super(message);
    this.name = 'LLMUnavailable';
  }
}

export interface StructuredLLMOptions {
  prompt: string;
  systemPrompt?: string;
  schema?: Record<string, unknown>;
  promptType: 'EXTRACTION' | 'NARRATION' | 'PLAYBOOK';
  model?: string;
}

export async function callStructuredLLM<T = any>(options: StructuredLLMOptions): Promise<{ data: T; cached: boolean }> {
  const apiKey = process.env.GROQ_API_KEY || (config as any).GROQ_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    throw new LLMUnavailable('GROQ_API_KEY is not set');
  }

  const model = options.model || 'llama-3.3-70b-versatile';
  const combinedInput = `${options.systemPrompt || ''}\n---\n${options.prompt}`;
  const inputHash = crypto.createHash('sha256').update(combinedInput).digest('hex');

  // 1. Check cache first
  const cachedEntry = await LlmCache.findOne({ input_hash: inputHash }).lean();
  if (cachedEntry) {
    try {
      const parsed = JSON.parse(cachedEntry.output_text);
      return { data: parsed as T, cached: true };
    } catch {
      // If cached data was corrupted, proceed to fetch
    }
  }

  // 2. Fetch from Groq
  try {
    const messages = [
      ...(options.systemPrompt ? [{ role: 'system', content: options.systemPrompt }] : []),
      { role: 'user', content: options.prompt },
    ];

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        response_format: { type: 'json_object' },
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      throw new LLMUnavailable(`Groq API returned HTTP ${response.status}: ${await response.text()}`);
    }

    const json = (await response.json()) as any;
    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      throw new LLMUnavailable('Empty response from Groq API');
    }

    const tokensUsed = json.usage?.total_tokens || 0;
    const parsedData = JSON.parse(content) as T;

    // Cache the successful output
    await LlmCache.findOneAndUpdate(
      { input_hash: inputHash },
      {
        $setOnInsert: {
          input_hash: inputHash,
          model,
          prompt_type: options.promptType,
          input_text: combinedInput,
          output_text: content,
          tokens_used: tokensUsed,
          created_at: new Date(),
        },
      },
      { upsert: true },
    );

    return { data: parsedData, cached: false };
  } catch (err: any) {
    if (err instanceof LLMUnavailable) throw err;
    throw new LLMUnavailable(`Failed to call LLM: ${err.message || String(err)}`);
  }
}

