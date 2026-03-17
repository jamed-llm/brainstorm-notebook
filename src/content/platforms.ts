/** Platform-specific DOM selectors and helpers for extracting conversations. */

export interface PlatformConfig {
  name: string;
  /** Selectors for the main scrollable conversation container */
  conversationList: string[];
  /** Selector for per-message wrappers */
  messageWrapper: string;
  /** Selectors for the stop/cancel button visible during generation */
  stopButton: string[];
  /** Selectors that identify a user message within a wrapper */
  userMessageContent: string[];
  /** Selectors that identify an assistant message within a wrapper */
  assistantMessageContent: string[];
  /** Selector for active streaming indicator */
  streaming: string;
  /** Extract conversation ID from the current URL */
  getConversationId: () => string | null;
  /** Check if a wrapper is a user message (optional override) */
  isUserMessage?: (wrapper: Element) => boolean;
  /** Extract text from a user message wrapper (optional override) */
  extractUserText?: (wrapper: Element) => string;
  /** Extract text from an assistant message wrapper (optional override) */
  extractAssistantText?: (wrapper: Element) => string;
}

const claude: PlatformConfig = {
  name: 'claude',
  conversationList: [
    '[data-testid="conversation-turn-list"]',
    'main [role="presentation"]',
  ],
  messageWrapper: '[data-test-render-count]',
  stopButton: [
    'button[aria-label="Stop"]',
    'button[aria-label="Cancel"]',
    'button[aria-label="Stop Response"]',
  ],
  userMessageContent: [
    '[data-testid="user-message"]',
  ],
  assistantMessageContent: [
    '.standard-markdown',
    '.progressive-markdown',
    '.font-claude-response',
    '[data-is-streaming]',
  ],
  streaming: '[data-is-streaming="true"]',
  getConversationId: () => {
    const match = window.location.pathname.match(/\/chat\/([a-f0-9-]+)/);
    return match?.[1] ?? null;
  },
};

const chatgpt: PlatformConfig = {
  name: 'chatgpt',
  conversationList: [
    '[role="presentation"]',
    'main',
  ],
  // Each conversation turn is an <article> with data-testid="conversation-turn-N"
  messageWrapper: 'article[data-testid^="conversation-turn-"]',
  stopButton: [
    'button[data-testid="stop-button"]',
    'button[aria-label="Stop generating"]',
    'button[aria-label="Stop streaming"]',
    'button[aria-label="停止生成"]',
    'button[aria-label="Stop"]',
  ],
  userMessageContent: [
    '[data-message-author-role="user"]',
  ],
  assistantMessageContent: [
    '[data-message-author-role="assistant"] .markdown',
    '[data-message-author-role="assistant"]',
  ],
  streaming: '.result-streaming, [data-is-streaming="true"]',
  getConversationId: () => {
    // chatgpt.com/c/<uuid>
    const match = window.location.pathname.match(/\/c\/([a-f0-9-]+)/);
    if (match) return match[1];
    // On the homepage, ChatGPT starts a conversation without navigating.
    // Use the first article's data-turn-id as a fallback conversation identifier.
    const firstArticle = document.querySelector('article[data-turn-id]');
    if (firstArticle) return 'chatgpt-' + firstArticle.getAttribute('data-turn-id');
    return null;
  },
  isUserMessage: (wrapper: Element) => {
    // <article data-turn="user">
    return wrapper.getAttribute('data-turn') === 'user';
  },
  extractUserText: (wrapper: Element) => {
    // User text is in .whitespace-pre-wrap inside the user bubble
    const el = wrapper.querySelector('.whitespace-pre-wrap');
    if (el) return el.textContent?.trim() ?? '';
    // Fallback to the data-message-author-role element
    const msg = wrapper.querySelector('[data-message-author-role="user"]');
    return msg?.textContent?.trim() ?? '';
  },
  extractAssistantText: (wrapper: Element) => {
    // Assistant text lives in .markdown.prose
    const markdown = wrapper.querySelector('.markdown.prose');
    if (markdown) return markdown.textContent?.trim() ?? '';
    // Fallback
    const msg = wrapper.querySelector('[data-message-author-role="assistant"]');
    return msg?.textContent?.trim() ?? '';
  },
};

const platforms: PlatformConfig[] = [claude, chatgpt];

export function detectPlatform(): PlatformConfig {
  const host = window.location.hostname;
  if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) return chatgpt;
  // Default to Claude
  return claude;
}

export function getPlatformByName(name: string): PlatformConfig | undefined {
  return platforms.find((p) => p.name === name);
}
