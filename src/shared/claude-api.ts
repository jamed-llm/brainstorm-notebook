import { AnalyzeTurnPayload, AnalyzeTurnResult, AnalyzeBatchPayload, AnalyzeBatchResult } from './messages';
import { buildNodeAnalysisPrompt, buildBatchAnalysisPrompt, buildMergePrompt, BatchNode, BatchTurn } from './prompts';

type Provider = 'anthropic' | 'openai' | 'gemini';

function detectProvider(apiKey: string): Provider {
  if (apiKey.startsWith('sk-ant-')) return 'anthropic';
  if (apiKey.startsWith('sk-')) return 'openai';
  if (apiKey.startsWith('AIza')) return 'gemini';
  return 'openai';
}

async function callAnthropic(prompt: string, apiKey: string, maxTokens: number): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text ?? '';
}

async function callOpenAI(prompt: string, apiKey: string, maxTokens: number): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? '';
}

async function callGemini(prompt: string, apiKey: string, maxTokens: number): Promise<string> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

async function callProvider(prompt: string, apiKey: string, maxTokens = 300): Promise<string> {
  const provider = detectProvider(apiKey);
  switch (provider) {
    case 'anthropic': return callAnthropic(prompt, apiKey, maxTokens);
    case 'openai': return callOpenAI(prompt, apiKey, maxTokens);
    case 'gemini': return callGemini(prompt, apiKey, maxTokens);
  }
}

function callWithFallback(prompt: string, apiKeys: string[], maxTokens = 300): Promise<string> {
  let lastError: Error | null = null;

  return apiKeys.reduce(
    (chain, key) =>
      chain.catch((err) => {
        lastError = err;
        return callProvider(prompt, key, maxTokens);
      }),
    callProvider(prompt, apiKeys[0], maxTokens),
  ).catch(() => {
    throw lastError ?? new Error('No API keys available');
  });
}

function cleanJson(raw: string): string {
  let s = raw
    .replace(/,\s*([}\]])/g, '$1')       // trailing commas
    .replace(/[\x00-\x1f]/g, (ch) =>     // unescaped control chars (keep \n \r \t)
      ch === '\n' || ch === '\r' || ch === '\t' ? ch : '',
    );

  // Attempt to repair truncated JSON by closing open brackets/braces
  const opens: string[] = [];
  let inString = false;
  let escape = false;
  for (const ch of s) {
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '[' || ch === '{') opens.push(ch);
    if (ch === ']' || ch === '}') opens.pop();
  }
  // Remove trailing partial value (e.g. truncated string or key)
  if (inString) {
    // Close the dangling string, then remove the incomplete entry
    s = s.replace(/"[^"]*$/, '""');
  }
  // Remove trailing comma before we close brackets
  s = s.replace(/,\s*$/, '');
  // Close any remaining open brackets/braces
  while (opens.length) {
    const open = opens.pop();
    s += open === '[' ? ']' : '}';
  }
  return s;
}

function parseJsonArray(text: string): unknown[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('No JSON array in API response');
  try {
    return JSON.parse(match[0]);
  } catch {
    return JSON.parse(cleanJson(match[0]));
  }
}

function parseJsonObject(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON in API response');
  try {
    return JSON.parse(match[0]);
  } catch {
    return JSON.parse(cleanJson(match[0]));
  }
}

// --- Single turn analysis (for live new responses) ---

export async function analyzeTurn(
  payload: AnalyzeTurnPayload,
  apiKeys: string[],
): Promise<AnalyzeTurnResult> {
  const prompt = buildNodeAnalysisPrompt(
    payload.existingNodes,
    payload.humanMessage,
    payload.assistantMessage,
  );

  const text = await callWithFallback(prompt, apiKeys);
  return parseJsonObject(text) as AnalyzeTurnResult;
}

// --- Batch analysis (for rebuild) ---

const CHUNK_SIZE = 20;

export async function analyzeBatch(
  payload: AnalyzeBatchPayload,
  apiKeys: string[],
): Promise<AnalyzeBatchResult> {
  const allTurns = payload.turns;

  if (allTurns.length <= CHUNK_SIZE) {
    // Single batch — send all turns at once
    return analyzeSingleBatch(allTurns, apiKeys);
  }

  // Chunk the turns and process each chunk, then merge
  const chunks: BatchTurn[][] = [];
  for (let i = 0; i < allTurns.length; i += CHUNK_SIZE) {
    chunks.push(allTurns.slice(i, i + CHUNK_SIZE));
  }

  const allNodes: BatchNode[] = [];
  const allEdges: { source: number; target: number; strength: 'strong' | 'middle' | 'thin' }[] = [];

  for (const chunk of chunks) {
    const result = await analyzeSingleBatch(chunk, apiKeys);
    for (const node of result.nodes) {
      allNodes.push(node);
      for (const parent of node.parents) {
        allEdges.push({ source: parent.index, target: node.index, strength: parent.strength });
      }
    }
  }

  // Merge pass: find cross-chunk connections
  const mergePrompt = buildMergePrompt(
    allNodes.map((n) => ({ index: n.index, title: n.title, summary: n.summary })),
    allEdges,
  );

  try {
    const maxTokens = Math.max(300, allNodes.length * 30);
    const mergeText = await callWithFallback(mergePrompt, apiKeys, maxTokens);
    const newEdges = parseJsonArray(mergeText) as { source: number; target: number; strength: 'strong' | 'middle' | 'thin' }[];

    // Add cross-chunk edges to the relevant target nodes
    for (const edge of newEdges) {
      const targetNode = allNodes.find((n) => n.index === edge.target);
      if (targetNode && !targetNode.parents.some((p) => p.index === edge.source)) {
        targetNode.parents.push({ index: edge.source, strength: edge.strength });
      }
    }
  } catch {
    // Merge is best-effort; skip on failure
  }

  return { nodes: allNodes };
}

async function analyzeSingleBatch(
  turns: BatchTurn[],
  apiKeys: string[],
): Promise<AnalyzeBatchResult> {
  const prompt = buildBatchAnalysisPrompt(turns);
  // Scale max tokens with turn count: ~120 tokens per turn for the response
  const maxTokens = Math.max(600, turns.length * 120);
  const text = await callWithFallback(prompt, apiKeys, maxTokens);
  const nodes = parseJsonArray(text) as BatchNode[];
  return { nodes };
}
