import type { ChatTurn, ConversationMetadata } from '../../../features/export/types/export';
import { getCurrentConversationId, isConversationRoute } from '../deepseek/selectors';

const USER_MESSAGE_SELECTORS = [
  '.d29f3d7d.ds-message',
  '.ds-message.d29f3d7d',
  '.d29f3d7d',
  '[data-role="user"]',
  '[class*="user"][class*="message"]',
];

const MESSAGE_SELECTOR = '.ds-message, [class*="ds-message"]';

export interface CollectionLogContext {
  debug: (message: string, context?: Record<string, unknown>) => void;
  warn: (message: string, context?: Record<string, unknown>) => void;
}

export interface DeepSeekChatTurn extends ChatTurn {
  turnId: string;
}

function normalizeText(text: string | null | undefined): string {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeMarkdownText(text: string | null | undefined): string {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function hashString(input: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function getConversationRoot(): HTMLElement {
  const user = document.querySelector(USER_MESSAGE_SELECTORS.join(','));
  let parent = user?.parentElement || null;

  while (parent && parent !== document.body) {
    if (parent.classList.contains('ds-scroll-area')) return parent;
    parent = parent.parentElement;
  }

  return (
    (document.querySelector('main') as HTMLElement | null) ||
    (document.querySelector('.ds-scroll-area') as HTMLElement | null) ||
    document.body
  );
}

function filterTopLevel(elements: Element[]): HTMLElement[] {
  const candidates = elements.map((element) => element as HTMLElement);
  return candidates.filter(
    (element, index) =>
      !candidates.some((other, otherIndex) => otherIndex !== index && other.contains(element))
  );
}

function getConfiguredUserSelectors(): string[] {
  let configured = '';
  try {
    configured =
      localStorage.getItem('deepseekTimelineUserTurnSelector') ||
      localStorage.getItem('deepseekTimelineUserTurnSelectorAuto') ||
      '';
  } catch {
    configured = '';
  }

  return configured
    ? [configured, ...USER_MESSAGE_SELECTORS.filter((selector) => selector !== configured)]
    : USER_MESSAGE_SELECTORS;
}

function isUserMessage(element: HTMLElement, userSelectors: string[]): boolean {
  return userSelectors.some((selector) => {
    try {
      return element.matches(selector);
    } catch {
      return false;
    }
  });
}

function findUserMessages(root: HTMLElement, userSelectors: string[]): HTMLElement[] {
  for (const selector of userSelectors) {
    try {
      const matches = filterTopLevel(Array.from(root.querySelectorAll(selector)));
      if (matches.length > 0) return matches;
    } catch {
      continue;
    }
  }

  return [];
}

function findAssistantForUser(
  user: HTMLElement,
  allMessages: HTMLElement[],
  users: HTMLElement[],
  index: number
): HTMLElement | undefined {
  const start = allMessages.indexOf(user);
  if (start < 0) return undefined;

  const nextUser = users[index + 1];
  const end = nextUser ? allMessages.indexOf(nextUser) : allMessages.length;
  const searchEnd = end > start ? end : allMessages.length;

  for (let i = start + 1; i < searchEnd; i++) {
    const candidate = allMessages[i];
    if (!users.includes(candidate)) return candidate;
  }

  return undefined;
}

function ensureTurnId(element: HTMLElement, index: number): string {
  const existing = element.dataset.turnId;
  if (existing) return existing;

  const basis = normalizeText(element.textContent) || `user-${index}`;
  const turnId = `u-${index}-${hashString(basis)}`;
  element.dataset.turnId = turnId;
  return turnId;
}

function readStarredSet(conversationId: string): Set<string> {
  try {
    const raw = localStorage.getItem(`deepseekTimelineStars:${conversationId}`);
    if (!raw) return new Set();

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();

    return new Set(parsed.map((item) => String(item)));
  } catch {
    return new Set();
  }
}

function cleanupDeepSeekClone(element: HTMLElement): HTMLElement {
  const clone = element.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll(
      [
        'button',
        '[role="button"]',
        'nav',
        'menu',
        'svg',
        'style',
        'script',
        '[class*="think" i]',
        '[class*="reason" i]',
        '[class*="思考"]',
        '[class*="推理"]',
      ].join(',')
    )
    .forEach((node) => node.remove());

  Array.from(clone.querySelectorAll<HTMLElement>('*')).forEach((node) => {
    const text = normalizeText(node.textContent);
    if (/^已思考[（(].*?[）)]/.test(text) || /^思考过程/.test(text)) {
      node.remove();
    }
  });

  return clone;
}

function getTexAnnotation(element: Element): string | null {
  if (element.tagName.toLowerCase() === 'annotation') {
    const encoding = element.getAttribute('encoding') || '';
    if (/tex/i.test(encoding)) return normalizeMarkdownText(element.textContent);
  }

  const tag = element.tagName.toLowerCase();
  const canOwnFormula =
    tag === 'math' ||
    tag === 'semantics' ||
    element.classList.contains('katex') ||
    element.classList.contains('katex-display');
  if (!canOwnFormula) return null;

  const annotation = element.querySelector('annotation[encoding*="tex" i]');
  return annotation ? normalizeMarkdownText(annotation.textContent) : null;
}

function isBlockMathElement(element: Element): boolean {
  return (
    element.classList.contains('katex-display') ||
    element.closest('.katex-display') === element ||
    element.getAttribute('display') === 'block'
  );
}

function extractDeepSeekMarkdown(element: HTMLElement): string {
  const clone = cleanupDeepSeekClone(element);

  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || '';
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    if (tag === 'annotation') return '';

    const tex = getTexAnnotation(el);
    if (tex) {
      return isBlockMathElement(el) ? `\n\\[\n${tex}\n\\]\n` : `\\(${tex}\\)`;
    }

    if (tag === 'br') return '\n';
    if (tag === 'hr') return '\n---\n';

    if (tag === 'pre') {
      const code = el.querySelector('code')?.textContent || el.textContent || '';
      const language = Array.from(el.querySelector('code')?.classList || [])
        .find((className) => className.startsWith('language-'))
        ?.replace(/^language-/, '');
      return `\n\`\`\`${language || ''}\n${code.trim()}\n\`\`\`\n`;
    }

    if (tag === 'code') {
      return `\`${el.textContent || ''}\``;
    }

    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag[1]);
      return `\n${'#'.repeat(level)} ${normalizeMarkdownText(Array.from(el.childNodes).map(walk).join(''))}\n`;
    }

    if (tag === 'li') {
      return `- ${normalizeMarkdownText(Array.from(el.childNodes).map(walk).join(''))}\n`;
    }

    const content = Array.from(el.childNodes).map(walk).join('');

    if (['p', 'div', 'section', 'article', 'blockquote', 'ul', 'ol'].includes(tag)) {
      return `\n${content.trim()}\n`;
    }

    return content;
  };

  return normalizeMarkdownText(walk(clone));
}

export function collectDeepSeekConversation(log?: CollectionLogContext): DeepSeekChatTurn[] {
  const userSelectors = getConfiguredUserSelectors();
  const root = getConversationRoot();
  const users = findUserMessages(root, userSelectors);
  const allMessages = filterTopLevel(Array.from(root.querySelectorAll(MESSAGE_SELECTOR))).filter(
    (message) => normalizeText(message.textContent)
  );

  log?.debug('Collected DeepSeek DOM candidates', {
    rootTag: root.tagName,
    userCount: users.length,
    messageCount: allMessages.length,
    userSelectors,
  });

  if (users.length === 0) {
    log?.warn('No user messages found for export', { userSelectors });
    return [];
  }

  const conversationId = `deepseek:${getCurrentConversationId() || hashString(location.href)}`;
  const starredSet = readStarredSet(conversationId);

  return users
    .map((user, index) => {
      const assistant = findAssistantForUser(user, allMessages, users, index);
      const turnId = ensureTurnId(user, index);
      const turn: DeepSeekChatTurn = {
        turnId,
        user: extractDeepSeekMarkdown(user),
        assistant: assistant ? extractDeepSeekMarkdown(assistant) : '',
        starred: starredSet.has(turnId),
      };

      log?.debug('Prepared export turn', {
        index,
        turnId,
        hasAssistant: Boolean(assistant),
        userLength: turn.user.length,
        assistantLength: turn.assistant.length,
        starred: turn.starred,
      });

      return turn;
    })
    .filter((turn) => turn.user || turn.assistant);
}

export function buildDeepSeekMetadata(turns: ChatTurn[]): ConversationMetadata {
  return {
    url: location.href,
    exportedAt: new Date().toISOString(),
    count: turns.length,
    title: document.title?.replace(/\s*-\s*DeepSeek\s*$/i, '').trim() || 'DeepSeek Conversation',
  };
}

export function canExportCurrentRoute(pathname = location.pathname): boolean {
  return isConversationRoute(pathname);
}
