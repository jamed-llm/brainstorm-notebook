import { render } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { ApiKeyEntry, ApiKeyStore } from '../shared/types';
import { encrypt, generateSalt } from '../shared/crypto';
import { saveKeyStore, loadKeyStore } from '../shared/storage';
import { KeyManager } from './key-manager';

function App() {
  const [keys, setKeys] = useState<ApiKeyEntry[]>([]);
  const [salt, setSalt] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [passphraseSet, setPassphraseSet] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyValue, setNewKeyValue] = useState('');
  const [status, setStatus] = useState('');
  const [statusError, setStatusError] = useState(false);

  useEffect(() => {
    loadKeyStore().then((store) => {
      if (store) {
        setKeys(store.keys);
        setSalt(store.salt);
      }
    });
  }, []);

  function showStatus(msg: string, isError = false) {
    setStatus(msg);
    setStatusError(isError);
    setTimeout(() => setStatus(''), 3000);
  }

  async function handleSetPassphrase() {
    if (!passphrase) return;
    // Send passphrase to service worker
    chrome.runtime.sendMessage({ type: 'SET_PASSPHRASE', passphrase });
    setPassphraseSet(true);
    if (!salt) {
      const newSalt = generateSalt();
      setSalt(newSalt);
    }
    showStatus('Passphrase set for this session');
  }

  async function handleAddKey() {
    if (!newKeyName || !newKeyValue) {
      showStatus('Enter both a name and API key', true);
      return;
    }
    if (!passphrase) {
      showStatus('Set a passphrase first', true);
      return;
    }

    let currentSalt = salt;
    if (!currentSalt) {
      currentSalt = generateSalt();
      setSalt(currentSalt);
    }

    const { ciphertext, iv } = await encrypt(newKeyValue, passphrase, currentSalt);
    const newEntry: ApiKeyEntry = {
      id: `key-${Date.now()}`,
      name: newKeyName,
      encryptedKey: ciphertext,
      iv,
      enabled: true,
      order: keys.length,
    };

    const updated = [...keys, newEntry];
    setKeys(updated);
    await saveKeyStore({ keys: updated, salt: currentSalt });

    setNewKeyName('');
    setNewKeyValue('');
    showStatus('Key added');
  }

  async function handleToggle(id: string) {
    const updated = keys.map((k) =>
      k.id === id ? { ...k, enabled: !k.enabled } : k,
    );
    setKeys(updated);
    await saveKeyStore({ keys: updated, salt });
  }

  async function handleDelete(id: string) {
    const updated = keys.filter((k) => k.id !== id);
    setKeys(updated);
    await saveKeyStore({ keys: updated, salt });
    showStatus('Key deleted');
  }

  async function handleReorder(fromIndex: number, toIndex: number) {
    const sorted = [...keys].sort((a, b) => a.order - b.order);
    const [moved] = sorted.splice(fromIndex, 1);
    sorted.splice(toIndex, 0, moved);
    const updated = sorted.map((k, i) => ({ ...k, order: i }));
    setKeys(updated);
    await saveKeyStore({ keys: updated, salt });
  }

  return (
    <div>
      <h1>Brainstorm Notebook</h1>
      <p class="subtitle">Settings for your mind-note graph extension</p>

      <div class="section">
        <h2>Passphrase</h2>
        <p style="font-size:13px;color:#6b7280;margin-bottom:10px">
          Enter a passphrase to encrypt/decrypt your API keys. Required once per browser session.
        </p>
        <div class="passphrase-input">
          <input
            type="password"
            placeholder="Enter passphrase"
            value={passphrase}
            onInput={(e) => setPassphrase((e.target as HTMLInputElement).value)}
          />
          <button class="primary" onClick={handleSetPassphrase}>
            {passphraseSet ? 'Updated' : 'Set'}
          </button>
        </div>
      </div>

      <div class="section">
        <h2>API Keys</h2>
        <p style="font-size:13px;color:#6b7280;margin-bottom:10px">
          Keys are tried in order. If one fails, the next is used.
        </p>
        <div class="add-key-form">
          <input
            type="text"
            placeholder="Key name"
            value={newKeyName}
            onInput={(e) => setNewKeyName((e.target as HTMLInputElement).value)}
          />
          <input
            type="password"
            placeholder="sk-ant-..."
            value={newKeyValue}
            onInput={(e) => setNewKeyValue((e.target as HTMLInputElement).value)}
          />
          <button class="primary" onClick={handleAddKey}>Add</button>
        </div>

        <KeyManager
          keys={keys}
          onToggle={handleToggle}
          onDelete={handleDelete}
          onReorder={handleReorder}
        />
      </div>

      {status && (
        <div class={`status-msg${statusError ? ' error' : ''}`}>{status}</div>
      )}
    </div>
  );
}

render(<App />, document.getElementById('app')!);
