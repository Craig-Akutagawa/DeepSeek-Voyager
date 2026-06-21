import { ConversationExportService } from '../../../features/export/services/ConversationExportService';
import { ExportFormat } from '../../../features/export/types/export';
import {
  buildDeepSeekMetadata,
  canExportCurrentRoute,
  collectDeepSeekConversation,
  type DeepSeekChatTurn,
} from './deepseekConversation';

const LOG_PREFIX = '[DeepSeek Voyager][Export]';
const EXPORT_BUTTON_ID = 'deepseek-voyager-export-button';
const EXPORT_HOST_ID = 'deepseek-voyager-export-host';
const EXPORT_POSITION_KEY = 'deepseekVoyagerExportButtonPosition';

type Language = 'en' | 'zh';
type Dictionary = Record<Language, Record<string, string>>;
type SelectableExportFormat = ExportFormat.MARKDOWN | ExportFormat.JSON;

const log = {
  debug(message: string, context?: Record<string, unknown>): void {
    console.debug(`${LOG_PREFIX} ${message}`, context || '');
  },
  info(message: string, context?: Record<string, unknown>): void {
    console.info(`${LOG_PREFIX} ${message}`, context || '');
  },
  warn(message: string, context?: Record<string, unknown>): void {
    console.warn(`${LOG_PREFIX} ${message}`, context || '');
  },
  error(message: string, context?: Record<string, unknown>): void {
    console.error(`${LOG_PREFIX} ${message}`, context || '');
  },
};

function normalizeLang(lang: string | undefined): Language {
  return lang && lang.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

async function loadDictionaries(): Promise<Dictionary> {
  try {
    const enRaw: unknown = await import('../../../locales/en/messages.json');
    const zhRaw: unknown = await import('../../../locales/zh/messages.json');
    const extract = (raw: unknown): Record<string, string> => {
      const source =
        raw && typeof raw === 'object' && 'default' in raw
          ? (raw as { default: unknown }).default
          : raw;
      const out: Record<string, string> = {};

      if (source && typeof source === 'object') {
        Object.entries(source as Record<string, { message?: unknown }>).forEach(([key, value]) => {
          if (typeof value?.message === 'string') out[key] = value.message;
        });
      }

      return out;
    };

    return { en: extract(enRaw), zh: extract(zhRaw) };
  } catch (error) {
    log.warn('Failed to load locale dictionaries, using built-in text', { error });
    return { en: {}, zh: {} };
  }
}

async function getLanguage(): Promise<Language> {
  try {
    const stored = await new Promise<{ language?: string }>((resolve) => {
      const getStorage = chrome.storage?.sync?.get as any;
      if (!getStorage) {
        resolve({});
        return;
      }
      getStorage('language', resolve);
    });

    return normalizeLang(stored?.language || navigator.language);
  } catch {
    return normalizeLang(navigator.language);
  }
}

function translate(dict: Dictionary, lang: Language, key: string, fallback: string): string {
  return dict[lang]?.[key] ?? dict.en?.[key] ?? fallback;
}

function ensureExportButton(): HTMLButtonElement {
  const existing = document.getElementById(EXPORT_BUTTON_ID);
  if (existing instanceof HTMLButtonElement) return existing;

  let host = document.getElementById(EXPORT_HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = EXPORT_HOST_ID;
    host.className = 'dsv-export-button-host';
    document.body.appendChild(host);
  }

  const button = document.createElement('button');
  button.id = EXPORT_BUTTON_ID;
  button.className = 'gv-export-btn dsv-export-btn';
  button.type = 'button';
  host.appendChild(button);

  log.info('Export button mounted', { route: location.pathname });
  return button;
}

function readSavedButtonPosition(): { left: number; top: number } | null {
  try {
    const raw = localStorage.getItem(EXPORT_POSITION_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.left !== 'number' ||
      typeof parsed?.top !== 'number' ||
      Number.isNaN(parsed.left) ||
      Number.isNaN(parsed.top)
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function clampButtonPosition(left: number, top: number, host: HTMLElement): { left: number; top: number } {
  const rect = host.getBoundingClientRect();
  const width = rect.width || 42;
  const height = rect.height || 42;
  const padding = 8;

  return {
    left: Math.min(Math.max(left, padding), window.innerWidth - width - padding),
    top: Math.min(Math.max(top, padding), window.innerHeight - height - padding),
  };
}

function applyButtonPosition(host: HTMLElement, position: { left: number; top: number }): void {
  const next = clampButtonPosition(position.left, position.top, host);
  host.style.left = `${next.left}px`;
  host.style.top = `${next.top}px`;
  host.style.right = 'auto';
  host.style.bottom = 'auto';
}

function setupDraggableButton(button: HTMLButtonElement): void {
  const host = document.getElementById(EXPORT_HOST_ID);
  if (!(host instanceof HTMLElement)) return;
  if (button.dataset.dsvDraggable === '1') return;
  button.dataset.dsvDraggable = '1';

  const savedPosition = readSavedButtonPosition();
  if (savedPosition) applyButtonPosition(host, savedPosition);

  let dragState:
    | {
        pointerId: number;
        startX: number;
        startY: number;
        startLeft: number;
        startTop: number;
        moved: boolean;
      }
    | null = null;

  button.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;

    const rect = host.getBoundingClientRect();
    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      moved: false,
    };
    button.setPointerCapture(event.pointerId);
  });

  button.addEventListener('pointermove', (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;

    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    if (Math.abs(dx) + Math.abs(dy) > 4) dragState.moved = true;
    if (!dragState.moved) return;

    event.preventDefault();
    applyButtonPosition(host, {
      left: dragState.startLeft + dx,
      top: dragState.startTop + dy,
    });
  });

  const finishDrag = (event: PointerEvent) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;

    const wasMoved = dragState.moved;
    dragState = null;

    try {
      button.releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }

    if (wasMoved) {
      const rect = host.getBoundingClientRect();
      const position = clampButtonPosition(rect.left, rect.top, host);
      localStorage.setItem(EXPORT_POSITION_KEY, JSON.stringify(position));
      button.dataset.dsvSuppressClick = '1';
      window.setTimeout(() => {
        delete button.dataset.dsvSuppressClick;
      }, 0);
      log.info('Export button position saved', position);
    }
  };

  button.addEventListener('pointerup', finishDrag);
  button.addEventListener('pointercancel', finishDrag);
  window.addEventListener('resize', () => {
    const saved = readSavedButtonPosition();
    if (saved) applyButtonPosition(host, saved);
  });
}

function updateButtonVisibility(button: HTMLButtonElement): void {
  const host = document.getElementById(EXPORT_HOST_ID);
  const visible = canExportCurrentRoute();
  if (host) host.hidden = !visible;
  button.disabled = !visible;
  log.debug('Export button visibility updated', {
    visible,
    pathname: location.pathname,
  });
}

function getTurnPreview(turn: DeepSeekChatTurn, index: number): string {
  const source = turn.user || turn.assistant || `Turn ${index + 1}`;
  return source.replace(/\s+/g, ' ').trim().slice(0, 110);
}

function createFormatOption(format: SelectableExportFormat, label: string, checked: boolean): HTMLLabelElement {
  const option = document.createElement('label');
  option.className = 'dsv-export-format-option';

  const input = document.createElement('input');
  input.type = 'radio';
  input.name = 'dsv-export-format';
  input.value = format;
  input.checked = checked;

  const text = document.createElement('span');
  text.textContent = label;

  option.appendChild(input);
  option.appendChild(text);
  return option;
}

function showSelectableExportDialog(options: {
  turns: DeepSeekChatTurn[];
  dict: Dictionary;
  lang: Language;
  onExport: (turns: DeepSeekChatTurn[], format: SelectableExportFormat) => Promise<void>;
}): void {
  const overlay = document.createElement('div');
  overlay.className = 'dsv-export-dialog-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'dsv-export-dialog';
  dialog.tabIndex = -1;

  const title = document.createElement('div');
  title.className = 'dsv-export-dialog-title';
  title.textContent = translate(options.dict, options.lang, 'export_dialog_title', 'Export Conversation');

  const subtitle = document.createElement('div');
  subtitle.className = 'dsv-export-dialog-subtitle';
  subtitle.textContent =
    options.lang === 'zh' ? '选择要导出的对话轮次和格式。' : 'Select turns and an export format.';

  const toolbar = document.createElement('div');
  toolbar.className = 'dsv-export-dialog-toolbar';

  const selectAllLabel = document.createElement('label');
  selectAllLabel.className = 'dsv-export-select-all';

  const selectAll = document.createElement('input');
  selectAll.type = 'checkbox';
  selectAll.checked = true;

  const selectAllText = document.createElement('span');
  selectAllText.textContent = options.lang === 'zh' ? '全选' : 'Select all';

  selectAllLabel.appendChild(selectAll);
  selectAllLabel.appendChild(selectAllText);
  toolbar.appendChild(selectAllLabel);

  const countLabel = document.createElement('span');
  countLabel.className = 'dsv-export-count';
  toolbar.appendChild(countLabel);

  const turnList = document.createElement('div');
  turnList.className = 'dsv-export-turn-list';

  const checkboxes: HTMLInputElement[] = [];
  options.turns.forEach((turn, index) => {
    const item = document.createElement('label');
    item.className = 'dsv-export-turn-option';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = turn.turnId;
    checkbox.checked = true;
    checkboxes.push(checkbox);

    const content = document.createElement('span');
    content.className = 'dsv-export-turn-content';

    const heading = document.createElement('span');
    heading.className = 'dsv-export-turn-heading';
    heading.textContent = `Turn ${index + 1}`;

    const preview = document.createElement('span');
    preview.className = 'dsv-export-turn-preview';
    preview.textContent = getTurnPreview(turn, index);

    content.appendChild(heading);
    content.appendChild(preview);
    item.appendChild(checkbox);
    item.appendChild(content);
    turnList.appendChild(item);
  });

  const formatGroup = document.createElement('div');
  formatGroup.className = 'dsv-export-format-list';
  formatGroup.appendChild(createFormatOption(ExportFormat.MARKDOWN, 'Markdown', true));
  formatGroup.appendChild(createFormatOption(ExportFormat.JSON, 'JSON', false));

  const buttons = document.createElement('div');
  buttons.className = 'gv-export-dialog-buttons';

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'gv-export-dialog-btn gv-export-dialog-btn-secondary';
  cancelButton.textContent = translate(options.dict, options.lang, 'pm_cancel', 'Cancel');

  const exportButton = document.createElement('button');
  exportButton.type = 'button';
  exportButton.className = 'gv-export-dialog-btn gv-export-dialog-btn-primary';
  exportButton.textContent = translate(options.dict, options.lang, 'pm_export', 'Export');

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', handleEscape);
  };

  const updateCount = () => {
    const selected = checkboxes.filter((checkbox) => checkbox.checked).length;
    countLabel.textContent =
      options.lang === 'zh'
        ? `已选择 ${selected} / ${checkboxes.length}`
        : `${selected} / ${checkboxes.length} selected`;
    selectAll.checked = selected === checkboxes.length;
    selectAll.indeterminate = selected > 0 && selected < checkboxes.length;
    exportButton.disabled = selected === 0;
  };

  const handleEscape = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close();
  };

  checkboxes.forEach((checkbox) => checkbox.addEventListener('change', updateCount));
  selectAll.addEventListener('change', () => {
    checkboxes.forEach((checkbox) => {
      checkbox.checked = selectAll.checked;
    });
    updateCount();
  });

  cancelButton.addEventListener('click', close);
  exportButton.addEventListener('click', () => {
    const selectedIds = new Set(
      checkboxes.filter((checkbox) => checkbox.checked).map((checkbox) => checkbox.value)
    );
    const selectedTurns = options.turns.filter((turn) => selectedIds.has(turn.turnId));
    const formatInput = dialog.querySelector<HTMLInputElement>('input[name="dsv-export-format"]:checked');
    const format = (formatInput?.value || ExportFormat.MARKDOWN) as SelectableExportFormat;

    close();
    void options.onExport(selectedTurns, format);
  });
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener('keydown', handleEscape);

  buttons.appendChild(cancelButton);
  buttons.appendChild(exportButton);

  dialog.appendChild(title);
  dialog.appendChild(subtitle);
  dialog.appendChild(toolbar);
  dialog.appendChild(turnList);
  dialog.appendChild(formatGroup);
  dialog.appendChild(buttons);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  updateCount();
  dialog.focus();
}

async function showExportDialog(dict: Dictionary, lang: Language): Promise<void> {
  log.info('Opening export dialog', { url: location.href });

  const turns = collectDeepSeekConversation(log);
  log.info('Conversation collected for export dialog', { count: turns.length });

  if (turns.length === 0) {
    log.warn('Export aborted because no turns were found');
    return;
  }

  showSelectableExportDialog({
    turns,
    dict,
    lang,
    onExport: async (selectedTurns, format) => {
      try {
        log.info('Export requested', { format, selectedCount: selectedTurns.length });
        const metadata = buildDeepSeekMetadata(selectedTurns);
        log.info('Selected conversation turns prepared for export', {
          format,
          count: selectedTurns.length,
          title: metadata.title,
        });

        if (selectedTurns.length === 0) {
          log.warn('Export aborted because no selected turns were found');
          return;
        }

        const result = await ConversationExportService.export(selectedTurns, metadata, {
          format,
        });

        if (result.success) {
          log.info('Export completed', {
            format: result.format,
            filename: result.filename,
          });
        } else {
          log.error('Export failed', {
            format: result.format,
            error: result.error,
          });
        }
      } catch (error) {
        log.error('Unhandled export error', { error });
      }
    },
  });
}

function watchRouteChanges(onChange: () => void): void {
  let lastHref = location.href;
  const notifyIfChanged = () => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    log.info('Route changed', { href: lastHref });
    onChange();
  };

  ['pushState', 'replaceState'].forEach((methodName) => {
    const historyApi = history as unknown as Record<string, (...args: any[]) => unknown>;
    const original = historyApi[methodName];
    historyApi[methodName] = function patchedHistoryMethod(this: History, ...args: any[]) {
      const result = original.apply(this, args);
      window.setTimeout(notifyIfChanged, 0);
      return result;
    };
  });

  window.addEventListener('popstate', notifyIfChanged);
}

export async function startExportButton(): Promise<void> {
  if (location.hostname !== 'chat.deepseek.com') {
    log.debug('Skipped export initialization on unsupported host', { hostname: location.hostname });
    return;
  }

  log.info('Initializing export feature');
  const dict = await loadDictionaries();
  let lang = await getLanguage();
  const button = ensureExportButton();
  setupDraggableButton(button);
  const refreshButton = () => updateButtonVisibility(button);

  const setButtonText = () => {
    const title = translate(dict, lang, 'exportChatJson', 'Export chat history');
    button.title = title;
    button.setAttribute('aria-label', title);
  };

  setButtonText();
  refreshButton();
  watchRouteChanges(refreshButton);

  try {
    chrome.storage?.onChanged?.addListener((changes, area) => {
      if (area !== 'sync' || typeof changes?.language?.newValue !== 'string') return;
      lang = normalizeLang(changes.language.newValue);
      setButtonText();
      log.info('Export language updated', { lang });
    });
  } catch (error) {
    log.warn('Unable to subscribe to language changes', { error });
  }

  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (button.dataset.dsvSuppressClick === '1') {
      log.debug('Suppressed click after drag');
      return;
    }

    if (!canExportCurrentRoute()) {
      log.warn('Export button clicked outside a conversation route', {
        pathname: location.pathname,
      });
      return;
    }

    void showExportDialog(dict, lang);
  });

  log.info('Export feature initialized', {
    formats: [ExportFormat.MARKDOWN, ExportFormat.JSON],
  });
}

export default { startExportButton };
