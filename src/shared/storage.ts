import { MindNoteGraph, ApiKeyStore } from './types';

const GRAPH_PREFIX = 'graph_';

export async function saveGraph(graph: MindNoteGraph): Promise<void> {
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
