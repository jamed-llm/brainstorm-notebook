import { togglePanel } from './panel';
import { ExtensionMessage } from '../shared/messages';

// Listen for toggle command from service worker
chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  if (message.type === 'TOGGLE_PANEL') {
    togglePanel();
  }
});

console.log('[Brainstorm Notebook] Content script loaded on', window.location.href);
