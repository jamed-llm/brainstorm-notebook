import { PlatformConfig, detectPlatform } from './platforms';

let platform: PlatformConfig = detectPlatform();

/** Allow re-detection (e.g. if observer is reused across navigations). */
export function refreshPlatform(): void {
  platform = detectPlatform();
}

export function getCurrentPlatformName(): string {
  return platform.name;
}

export interface ConversationTurn {
  human: string;
  assistant: string;
}

type ResponseCompleteCallback = (turns: ConversationTurn[], latestTurn: ConversationTurn) => void;

export function getConversationId(): string | null {
  return platform.getConversationId();
}

/** Find all message wrapper elements in DOM order. */
export function findAllMessageElements(): Element[] {
  return Array.from(document.querySelectorAll(platform.messageWrapper));
}

function queryFirst(selectors: string[]): Element | null {
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el) return el;
  }
  return null;
}

function findConversationContainer(): Element | null {
  const el = queryFirst(platform.conversationList);
  if (el) return el;
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
  if (platform.isUserMessage) return platform.isUserMessage(wrapper);
  return queryFirstIn(wrapper, platform.userMessageContent) !== null;
}

/** Extract clean text from a user message wrapper. */
function extractUserText(wrapper: Element): string {
  if (platform.extractUserText) return platform.extractUserText(wrapper);
  const contentEl = queryFirstIn(wrapper, platform.userMessageContent);
  return contentEl?.textContent?.trim() ?? '';
}

/** Extract clean text from an assistant message wrapper. */
function extractAssistantText(wrapper: Element): string {
  if (platform.extractAssistantText) return platform.extractAssistantText(wrapper);
  const contentEl = queryFirstIn(wrapper, platform.assistantMessageContent);
  return contentEl?.textContent?.trim() ?? '';
}

function extractTurnsFromWrappers(): ConversationTurn[] {
  const wrappers = document.querySelectorAll(platform.messageWrapper);
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
  /** Called when URL changes so the panel can re-initialize. */
  onNavigate: ((convId: string | null) => void) | null;
}

export function startObserver(onResponseComplete: ResponseCompleteCallback): ObserverHandle {
  let lastTurnCount = extractAllTurns().length;
  let wasGenerating = false;

  function isGenerating(): boolean {
    if (queryFirst(platform.stopButton) !== null) return true;
    if (document.querySelector(platform.streaming) !== null) return true;
    // On ChatGPT: if the last article is a user turn, the assistant is about to respond
    const wrappers = document.querySelectorAll(platform.messageWrapper);
    if (wrappers.length > 0) {
      const last = wrappers[wrappers.length - 1];
      if (platform.isUserMessage?.(last)) return true;
    }
    return false;
  }

  let lastConvId = getConversationId();

  function checkConversationChange(): void {
    const currentConvId = getConversationId();
    if (currentConvId && currentConvId !== lastConvId) {
      lastConvId = currentConvId;
      lastTurnCount = 0;
      handle.onNavigate?.(currentConvId);
    }
  }

  function checkTurns() {
    checkConversationChange();
    const turns = extractAllTurns();
    if (turns.length > lastTurnCount && turns.length > 0) {
      lastTurnCount = turns.length;
      onResponseComplete(turns, turns[turns.length - 1]);
    }
  }

  const pollInterval = setInterval(() => {
    const generating = isGenerating();

    if (wasGenerating && !generating) {
      wasGenerating = false;
      setTimeout(checkTurns, 800);
    } else if (!generating) {
      checkTurns();
    }

    wasGenerating = generating;
  }, 2000);

  let lastUrl = location.href;
  const urlCheckInterval = setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastTurnCount = 0;
      refreshPlatform();
      handle.onNavigate?.(getConversationId());
    }
  }, 1000);

  const handle: ObserverHandle = {
    cleanup: () => {
      clearInterval(pollInterval);
      clearInterval(urlCheckInterval);
    },
    syncTurnCount: () => {
      lastTurnCount = extractAllTurns().length;
    },
    onNavigate: null,
  };

  return handle;
}
