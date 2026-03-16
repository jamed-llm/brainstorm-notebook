// Selectors config — update here when Claude changes its DOM
// Each message (user or assistant) is wrapped in div[data-test-render-count].
// User messages contain [data-testid="user-message"].
// Assistant messages contain [data-is-streaming] and .font-claude-response.
// Actual assistant text lives in .standard-markdown or .progressive-markdown.
const SELECTORS = {
  // The main scrollable conversation container
  conversationList: [
    '[data-testid="conversation-turn-list"]',
    'main [role="presentation"]',
  ],
  // Per-message wrapper (one per user or assistant message)
  messageWrapper: '[data-test-render-count]',
  // The stop/cancel button visible during generation
  stopButton: [
    'button[aria-label="Stop"]',
    'button[aria-label="Cancel"]',
    'button[aria-label="Stop Response"]',
  ],
  // Identifying a user message within a wrapper
  userMessageContent: [
    '[data-testid="user-message"]',
  ],
  // Identifying an assistant message within a wrapper
  assistantMessageContent: [
    '.standard-markdown',
    '.progressive-markdown',
    '.font-claude-response',
    '[data-is-streaming]',
  ],
  // Active streaming indicator
  streaming: '[data-is-streaming="true"]',
};

export interface ConversationTurn {
  human: string;
  assistant: string;
}

type ResponseCompleteCallback = (turns: ConversationTurn[], latestTurn: ConversationTurn) => void;

export function getConversationId(): string | null {
  const match = window.location.pathname.match(/\/chat\/([a-f0-9-]+)/);
  return match?.[1] ?? null;
}

/** Find all message wrapper elements in DOM order. */
export function findAllMessageElements(): Element[] {
  return Array.from(document.querySelectorAll(SELECTORS.messageWrapper));
}

function queryFirst(selectors: string[]): Element | null {
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el) return el;
  }
  return null;
}

function findConversationContainer(): Element | null {
  // Try selectors first
  const el = queryFirst(SELECTORS.conversationList);
  if (el) return el;
  // Fallback: find main content area
  return document.querySelector('main') ?? document.querySelector('[role="main"]');
}

function queryFirstIn(parent: Element, selectors: string[]): Element | null {
  for (const selector of selectors) {
    const el = parent.querySelector(selector);
    if (el) return el;
  }
  return null;
}

/** Check if a message wrapper contains a user message. */
function isUserMessage(wrapper: Element): boolean {
  return queryFirstIn(wrapper, SELECTORS.userMessageContent) !== null;
}

/** Extract clean text from a user message wrapper. */
function extractUserText(wrapper: Element): string {
  const contentEl = queryFirstIn(wrapper, SELECTORS.userMessageContent);
  return contentEl?.textContent?.trim() ?? '';
}

/** Extract clean text from an assistant message wrapper.
 *  Targets .standard-markdown / .progressive-markdown to avoid
 *  picking up "Thought for Xs", button labels, etc. */
function extractAssistantText(wrapper: Element): string {
  const contentEl = queryFirstIn(wrapper, SELECTORS.assistantMessageContent);
  return contentEl?.textContent?.trim() ?? '';
}

function extractTurnsFromWrappers(): ConversationTurn[] {
  const wrappers = document.querySelectorAll(SELECTORS.messageWrapper);
  if (wrappers.length < 2) return [];

  const turns: ConversationTurn[] = [];
  let currentHuman: string | null = null;

  for (const wrapper of wrappers) {
    if (isUserMessage(wrapper)) {
      currentHuman = extractUserText(wrapper);
    } else if (currentHuman !== null) {
      const assistantText = extractAssistantText(wrapper);
      if (assistantText) {
        turns.push({ human: currentHuman, assistant: assistantText });
        currentHuman = null;
      }
    }
  }

  return turns;
}

function extractTurnsFallback(): ConversationTurn[] {
  const container = findConversationContainer();
  if (!container) return [];

  // Last resort: assume alternating children pairs
  const children = Array.from(container.children).filter(
    (el) => el.textContent?.trim(),
  );

  const turns: ConversationTurn[] = [];
  for (let i = 0; i + 1 < children.length; i += 2) {
    const human = children[i].textContent?.trim() ?? '';
    const assistant = children[i + 1].textContent?.trim() ?? '';
    if (human && assistant) {
      turns.push({ human, assistant });
    }
  }

  return turns;
}

/** Extract all conversation turns currently visible in the DOM. */
export function extractAllTurns(): ConversationTurn[] {
  const turns = extractTurnsFromWrappers();
  return turns.length > 0 ? turns : extractTurnsFallback();
}

export interface ObserverHandle {
  /** Stop observing. */
  cleanup: () => void;
  /** Sync the internal turn count to the current DOM (call after Rebuild). */
  syncTurnCount: () => void;
}

export function startObserver(onResponseComplete: ResponseCompleteCallback): ObserverHandle {
  // Initialize to current turn count so we only fire for truly new turns
  let lastTurnCount = extractAllTurns().length;
  let wasGenerating = false;

  function isGenerating(): boolean {
    return queryFirst(SELECTORS.stopButton) !== null ||
      document.querySelector(SELECTORS.streaming) !== null;
  }

  function checkTurns() {
    const turns = extractAllTurns();
    if (turns.length > lastTurnCount && turns.length > 0) {
      lastTurnCount = turns.length;
      onResponseComplete(turns, turns[turns.length - 1]);
    }
  }

  // Poll every 2s — reliable regardless of MutationObserver quirks.
  // When streaming finishes (wasGenerating transitions to false),
  // wait a beat for the DOM to settle, then check for new turns.
  const pollInterval = setInterval(() => {
    const generating = isGenerating();

    if (wasGenerating && !generating) {
      // Just finished generating — check after a short delay
      wasGenerating = false;
      setTimeout(checkTurns, 800);
    } else if (!generating) {
      checkTurns();
    }

    wasGenerating = generating;
  }, 2000);

  // Also handle SPA navigation
  let lastUrl = location.href;
  const urlCheckInterval = setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastTurnCount = 0;
    }
  }, 1000);

  return {
    cleanup: () => {
      clearInterval(pollInterval);
      clearInterval(urlCheckInterval);
    },
    syncTurnCount: () => {
      lastTurnCount = extractAllTurns().length;
    },
  };
}
