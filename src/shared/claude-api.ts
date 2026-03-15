import { AnalyzeTurnPayload, AnalyzeTurnResult } from './messages';
import { buildNodeAnalysisPrompt } from './prompts';

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
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 300,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (response.status === 401 || response.status === 403 || response.status === 429) {
        lastError = new Error(`API key failed with status ${response.status}`);
        continue;
      }

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      const text = data.content?.[0]?.text ?? '';
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
