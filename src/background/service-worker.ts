import { ExtensionMessage, AnalyzeTurnPayload, AnalyzeTurnResult } from '../shared/messages';
import { loadKeyStore } from '../shared/storage';
import { decrypt } from '../shared/crypto';
import { analyzeTurn } from '../shared/claude-api';

let cachedPassphrase: string | null = null;

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
    return true; // async response
  }
});

async function getDecryptedKeys(): Promise<string[]> {
  const store = await loadKeyStore();
  if (!store || store.keys.length === 0) {
    throw new Error('No API keys configured. Open extension settings to add keys.');
  }

  if (!cachedPassphrase) {
    // In a real scenario, we'd prompt the user. For now, use a default.
    // The options page will set this via a message.
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

// Listen for passphrase from options page
chrome.runtime.onMessage.addListener((message: { type: string; passphrase?: string }) => {
  if (message.type === 'SET_PASSPHRASE' && message.passphrase) {
    cachedPassphrase = message.passphrase;
  }
});
