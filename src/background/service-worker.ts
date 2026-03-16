import { ExtensionMessage, AnalyzeTurnPayload, AnalyzeTurnResult, AnalyzeBatchPayload, AnalyzeBatchResult } from '../shared/messages';
import { loadKeyStore, loadPassphrase, savePassphrase } from '../shared/storage';
import { decrypt } from '../shared/crypto';
import { analyzeTurn, analyzeBatch } from '../shared/claude-api';

let cachedPassphrase: string | null = null;

// Load saved passphrase on startup
loadPassphrase().then((p) => {
  if (p) cachedPassphrase = p;
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' } as ExtensionMessage);
  }
});

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (message.type === 'ANALYZE_TURN') {
    handleAnalyzeTurn(message.payload).then(
      (result) => sendResponse({ type: 'ANALYZE_TURN_RESULT', payload: result }),
      (err) => sendResponse({ type: 'API_ERROR', error: (err as Error).message }),
    );
    return true;
  }

  if (message.type === 'ANALYZE_BATCH') {
    handleAnalyzeBatch(message.payload).then(
      (result) => sendResponse({ type: 'ANALYZE_BATCH_RESULT', payload: result }),
      (err) => sendResponse({ type: 'API_ERROR', error: (err as Error).message }),
    );
    return true;
  }
});

async function getDecryptedKeys(): Promise<string[]> {
  const store = await loadKeyStore();
  if (!store || store.keys.length === 0) {
    throw new Error('No API keys configured. Open extension settings to add keys.');
  }

  if (!cachedPassphrase) {
    throw new Error('Passphrase not set. Please open extension settings.');
  }

  const enabledKeys = store.keys
    .filter((k) => k.enabled)
    .sort((a, b) => a.order - b.order);

  const decrypted: string[] = [];
  for (const key of enabledKeys) {
    try {
      decrypted.push(await decrypt(key.encryptedKey, key.iv, cachedPassphrase, store.salt));
    } catch {
      // skip keys that fail to decrypt
    }
  }

  if (decrypted.length === 0) {
    throw new Error('No keys could be decrypted. Check your passphrase.');
  }

  return decrypted;
}

async function handleAnalyzeTurn(payload: AnalyzeTurnPayload): Promise<AnalyzeTurnResult> {
  const keys = await getDecryptedKeys();
  return analyzeTurn(payload, keys);
}

async function handleAnalyzeBatch(payload: AnalyzeBatchPayload): Promise<AnalyzeBatchResult> {
  const keys = await getDecryptedKeys();
  return analyzeBatch(payload, keys);
}

// Listen for passphrase from options page
chrome.runtime.onMessage.addListener((message: { type: string; passphrase?: string }) => {
  if (message.type === 'SET_PASSPHRASE' && message.passphrase) {
    cachedPassphrase = message.passphrase;
    savePassphrase(message.passphrase);
  }
});
