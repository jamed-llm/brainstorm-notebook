import { MindNoteGraph, ApiKeyStore } from './types';

const GRAPH_PREFIX = 'graph_';

export async function saveGraph(graph: MindNoteGraph): Promise<void> {
  graph.updatedAt = Date.now();
  await chrome.storage.local.set({ [GRAPH_PREFIX + graph.conversationId]: graph });
}

export async function loadGraph(conversationId: string): Promise<MindNoteGraph | null> {
  const result = await chrome.storage.local.get(GRAPH_PREFIX + conversationId);
  return result[GRAPH_PREFIX + conversationId] ?? null;
}

export async function saveKeyStore(store: ApiKeyStore): Promise<void> {
  await chrome.storage.local.set({ apiKeyStore: store });
}

export async function loadKeyStore(): Promise<ApiKeyStore | null> {
  const result = await chrome.storage.local.get('apiKeyStore');
  return result.apiKeyStore ?? null;
}

export async function savePassphrase(passphrase: string): Promise<void> {
  await chrome.storage.local.set({ passphrase });
}

export async function loadPassphrase(): Promise<string | null> {
  const result = await chrome.storage.local.get('passphrase');
  return result.passphrase ?? null;
}

export async function saveLlmMode(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ llmMode: enabled });
}

export async function loadLlmMode(): Promise<boolean> {
  const result = await chrome.storage.local.get('llmMode');
  return result.llmMode ?? true;
}

export async function clearAllGraphs(): Promise<number> {
  const all = await chrome.storage.local.get(null);
  const graphKeys = Object.keys(all).filter((k) => k.startsWith(GRAPH_PREFIX));
  if (graphKeys.length > 0) {
    await chrome.storage.local.remove(graphKeys);
  }
  return graphKeys.length;
}

export interface GraphCacheStats {
  count: number;
  sizeBytes: number;
}

export async function getGraphCacheStats(): Promise<GraphCacheStats> {
  const all = await chrome.storage.local.get(null);
  const graphEntries = Object.entries(all).filter(([k]) => k.startsWith(GRAPH_PREFIX));
  const sizeBytes = graphEntries.reduce(
    (sum, [, v]) => sum + new Blob([JSON.stringify(v)]).size,
    0,
  );
  return { count: graphEntries.length, sizeBytes };
}

/**
 * Clear graphs older than the given age. Graphs without an updatedAt
 * timestamp (created before this feature) are treated as old enough to clear.
 */
export async function clearGraphsByAge(maxAgeMs: number): Promise<number> {
  const cutoff = Date.now() - maxAgeMs;
  const all = await chrome.storage.local.get(null);
  const toRemove = Object.entries(all)
    .filter(([k, v]) => k.startsWith(GRAPH_PREFIX) && ((v as MindNoteGraph).updatedAt ?? 0) < cutoff)
    .map(([k]) => k);
  if (toRemove.length > 0) {
    await chrome.storage.local.remove(toRemove);
  }
  return toRemove.length;
}
