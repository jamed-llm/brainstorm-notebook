// Selectors config — update here when Claude changes its DOM
const SELECTORS = {
  // The main scrollable conversation container
  conversationList: '[class*="conversation"], [data-testid="conversation-turn-list"], main [role="presentation"]',
  // The stop/cancel button visible during generation
  stopButton: 'button[aria-label="Stop"], button[aria-label="Cancel"]',
  // Human message blocks
  humanMessage: '[data-testid="human-turn"], [class*="human"]',
  // Assistant message blocks
  assistantMessage: '[data-testid="assistant-turn"], [class*="assistant"]',
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

export function startObserver(onResponseComplete: ResponseCompleteCallback): () => void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastTurnCount = 0;

  function findConversationContainer(): Element | null {
    // Try selectors first
    for (const selector of SELECTORS.conversationList.split(', ')) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    // Fallback: find main content area
    return document.querySelector('main') ?? document.querySelector('[role="main"]');
  }

  function extractTurns(): ConversationTurn[] {
    const turns: ConversationTurn[] = [];

    // Strategy: walk all message blocks in order, pairing human+assistant
    const allMessages = document.querySelectorAll(
      `${SELECTORS.humanMessage}, ${SELECTORS.assistantMessage}`,
    );

    if (allMessages.length === 0) {
      // Fallback: get all direct children of conversation container
      return extractTurnsFallback();
    }

    let currentHuman: string | null = null;
    for (const el of allMessages) {
      const isHuman =
        el.matches(SELECTORS.humanMessage) ||
        el.querySelector('[data-testid="human-turn"]') !== null;

      const text = el.textContent?.trim() ?? '';
      if (isHuman) {
        currentHuman = text;
      } else if (currentHuman !== null) {
        turns.push({ human: currentHuman, assistant: text });
        currentHuman = null;
      }
    }

    return turns;
  }

  function extractTurnsFallback(): ConversationTurn[] {
    const container = findConversationContainer();
    if (!container) return [];

    const turns: ConversationTurn[] = [];
    const children = Array.from(container.children);

    for (let i = 0; i + 1 < children.length; i += 2) {
      turns.push({
        human: children[i].textContent?.trim() ?? '',
        assistant: children[i + 1].textContent?.trim() ?? '',
      });
    }

    return turns;
  }

  function isGenerating(): boolean {
    for (const selector of SELECTORS.stopButton.split(', ')) {
      if (document.querySelector(selector)) return true;
    }
    return false;
  }

  function checkForNewResponse() {
    if (isGenerating()) return;

    const turns = extractTurns();
    if (turns.length > lastTurnCount && turns.length > 0) {
      lastTurnCount = turns.length;
      onResponseComplete(turns, turns[turns.length - 1]);
    }
  }

  const container = findConversationContainer();
  if (!container) {
    console.warn('[Brainstorm Notebook] Could not find conversation container');
  }

  // Observe for DOM changes
  const observer = new MutationObserver(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(checkForNewResponse, 1500);
  });

  const target = container ?? document.body;
  observer.observe(target, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  // Also handle SPA navigation
  let lastUrl = location.href;
  const urlCheckInterval = setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastTurnCount = 0;
      // Re-attach observer to new container
      observer.disconnect();
      const newContainer = findConversationContainer();
      if (newContainer) {
        observer.observe(newContainer, { childList: true, subtree: true, characterData: true });
      }
    }
  }, 1000);

  // Return cleanup function
  return () => {
    observer.disconnect();
    clearInterval(urlCheckInterval);
    if (debounceTimer) clearTimeout(debounceTimer);
  };
}
