import { togglePanel, injectFloatingButton } from './panel';
import { ExtensionMessage } from '../shared/messages';

// Listen for toggle command from service worker (extension icon click)
chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  if (message.type === 'TOGGLE_PANEL') {
    togglePanel();
  }
});

// Inject floating button so the panel can be opened without the extension icon
injectFloatingButton();

console.log('[Brainstorm Notebook] Content script loaded on', window.location.href);
