import { AnalyzeTurnPayload, AnalyzeTurnResult } from './messages';
import { buildNodeAnalysisPrompt } from './prompts';

type Provider = 'anthropic' | 'openai' | 'gemini';

function detectProvider(apiKey: string): Provider {
  if (apiKey.startsWith('sk-ant-')) return 'anthropic';
  if (apiKey.startsWith('sk-')) return 'openai';
  if (apiKey.startsWith('AIza')) return 'gemini';
  // Default to OpenAI format as it's the most common sk- pattern
  return 'openai';
}

async function callAnthropic(prompt: string, apiKey: string): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text ?? '';
}

async function callOpenAI(prompt: string, apiKey: string): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? '';
}

async function callGemini(prompt: string, apiKey: string): Promise<string> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 300 },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

async function callProvider(prompt: string, apiKey: string): Promise<string> {
  const provider = detectProvider(apiKey);
  switch (provider) {
    case 'anthropic': return callAnthropic(prompt, apiKey);
    case 'openai': return callOpenAI(prompt, apiKey);
    case 'gemini': return callGemini(prompt, apiKey);
  }
}

export async function analyzeTurn(
  payload: AnalyzeTurnPayload,
  apiKeys: string[],
): Promise<AnalyzeTurnResult> {
  const prompt = buildNodeAnalysisPrompt(
    payload.existingNodes,
    payload.humanMessage,
    payload.assistantMessage,
  );

  let lastError: Error | null = null;

  for (const key of apiKeys) {
    try {
      const text = await callProvider(prompt, key);
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in API response');

      return JSON.parse(jsonMatch[0]) as AnalyzeTurnResult;
    } catch (err) {
      lastError = err as Error;
      continue;
    }
  }

  throw lastError ?? new Error('No API keys available');
}
