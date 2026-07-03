/**
 * Adjusts the font size (in px) and icon size of folder names and conversation titles
 * inside DeepSeek Voyager's folder panel.
 */

const STYLE_ID = 'ds-folder-item-size-style';
const STORAGE_KEY_FONT = 'dsFolderItemFontSize';
const STORAGE_KEY_ICON = 'dsFolderIconSize';

export const FOLDER_ITEM_FONT_SIZE_DEFAULT = 13;
export const FOLDER_ITEM_FONT_SIZE_MIN = 12;
export const FOLDER_ITEM_FONT_SIZE_MAX = 18;

export const FOLDER_ITEM_ICON_SIZE_DEFAULT = 16;
export const FOLDER_ITEM_ICON_SIZE_MIN = 14;
export const FOLDER_ITEM_ICON_SIZE_MAX = 24;

export function clampFolderItemFontSize(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return FOLDER_ITEM_FONT_SIZE_DEFAULT;
  return Math.min(FOLDER_ITEM_FONT_SIZE_MAX, Math.max(FOLDER_ITEM_FONT_SIZE_MIN, Math.round(n)));
}

export function clampFolderItemIconSize(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return FOLDER_ITEM_ICON_SIZE_DEFAULT;
  return Math.min(FOLDER_ITEM_ICON_SIZE_MAX, Math.max(FOLDER_ITEM_ICON_SIZE_MIN, Math.round(n)));
}

function applySizes(fontSize: number, iconSize: number) {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  const lineHeight = Math.round(fontSize * 1.3);
  style.textContent = `
    .gv-folder-container .gv-folder-name,
    .gv-folder-container .gv-conversation-title {
      font-size: ${fontSize}px !important;
      line-height: ${lineHeight}px !important;
    }
    .gv-folder-container .gv-folder-icon,
    .gv-folder-container .gv-conversation-icon,
    .gv-folder-container .material-icons {
      width: ${iconSize}px !important;
      height: ${iconSize}px !important;
      font-size: ${iconSize}px !important;
      line-height: ${iconSize}px !important;
    }
  `;
}

function removeStyles() {
  document.getElementById(STYLE_ID)?.remove();
}

export function startFolderItemFontSizeAdjuster() {
  let fontSize = FOLDER_ITEM_FONT_SIZE_DEFAULT;
  let iconSize = FOLDER_ITEM_ICON_SIZE_DEFAULT;

  chrome.storage?.sync?.get(
    {
      [STORAGE_KEY_FONT]: FOLDER_ITEM_FONT_SIZE_DEFAULT,
      [STORAGE_KEY_ICON]: FOLDER_ITEM_ICON_SIZE_DEFAULT,
    },
    (res) => {
      fontSize = clampFolderItemFontSize(res?.[STORAGE_KEY_FONT]);
      iconSize = clampFolderItemIconSize(res?.[STORAGE_KEY_ICON]);
      applySizes(fontSize, iconSize);
    }
  );

  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'sync') return;
    let changed = false;
    if (changes[STORAGE_KEY_FONT]) {
      fontSize = clampFolderItemFontSize(changes[STORAGE_KEY_FONT].newValue);
      changed = true;
    }
    if (changes[STORAGE_KEY_ICON]) {
      iconSize = clampFolderItemIconSize(changes[STORAGE_KEY_ICON].newValue);
      changed = true;
    }
    if (changed) {
      applySizes(fontSize, iconSize);
    }
  };

  chrome.storage?.onChanged?.addListener(handler);

  window.addEventListener(
    'beforeunload',
    () => {
      removeStyles();
      try {
        chrome.storage?.onChanged?.removeListener(handler);
      } catch {
        // ignore
      }
    },
    { once: true }
  );
}
