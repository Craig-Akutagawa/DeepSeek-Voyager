import React, { useEffect, useState, useCallback } from 'react';

import { DarkModeToggle } from '../../components/DarkModeToggle';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardTitle } from '../../components/ui/card';
import { Label } from '../../components/ui/label';
import { Switch } from '../../components/ui/switch';
import { useLanguage } from '../../contexts/LanguageContext';
import { useWidthAdjuster } from '../../hooks/useWidthAdjuster';

import WidthSlider from './components/WidthSlider';

type ScrollMode = 'jump' | 'flow';

interface StarredMessage {
  conversationId: string;
  turnId: string;
  content: string;
  starredAt: number;
  conversationUrl: string;
  conversationTitle?: string;
}

export default function Popup() {
  const { t, language } = useLanguage();
  const [activeTab, setActiveTab] = useState<'settings' | 'bookmarks'>('settings');
  const [mode, setMode] = useState<ScrollMode>('flow');
  const [timelineEnabled, setTimelineEnabled] = useState<boolean>(false);

  // Folder Settings
  const [hideFolderPanel, setHideFolderPanel] = useState<boolean>(false);
  const [folderFontSize, setFolderFontSize] = useState<number>(13);
  const [folderIconSize, setFolderIconSize] = useState<number>(16);
  const [folderPositionOffset, setFolderPositionOffset] = useState<number>(0);

  // Starred messages
  const [starredMessages, setStarredMessages] = useState<StarredMessage[]>([]);

  // Fetch all starred messages from background storage
  const fetchStarredMessages = useCallback(() => {
    try {
      chrome.runtime?.sendMessage({ type: 'ds.starred.getAll' }, (response) => {
        if (response && response.ok && response.data?.messages) {
          const list: StarredMessage[] = [];
          Object.values(response.data.messages).forEach((arr: any) => {
            if (Array.isArray(arr)) {
              list.push(...arr);
            }
          });
          list.sort((a, b) => b.starredAt - a.starredAt);
          setStarredMessages(list);
        }
      });
    } catch (e) {
      console.warn('Failed to fetch starred messages:', e);
    }
  }, []);

  // Helper function to apply settings to storage
  const apply = useCallback(
    (nextMode: ScrollMode | null, nextEnabled?: boolean, resetPosition?: boolean) => {
      const payload: any = {};
      if (nextMode) payload.deepseekTimelineScrollMode = nextMode;
      if (typeof nextEnabled === 'boolean') {
        payload.deepseekTimelineEnabled = nextEnabled;
        if (nextEnabled) {
          payload.deepseekTimelineHideContainer = true;
          payload.deepseekTimelineDraggable = true;
        }
      }
      if (resetPosition) payload.deepseekTimelinePosition = null;
      try {
        chrome.storage?.sync?.set(payload);
      } catch {}
    },
    []
  );

  // Width adjuster for chat width
  const chatWidthAdjuster = useWidthAdjuster({
    storageKey: 'geminiChatWidth',
    defaultValue: 800,
    onApply: useCallback((width: number) => {
      try {
        chrome.storage?.sync?.set({ geminiChatWidth: width });
      } catch {}
    }, []),
  });

  // Width adjuster for edit input width
  const editInputWidthAdjuster = useWidthAdjuster({
    storageKey: 'geminiEditInputWidth',
    defaultValue: 600,
    onApply: useCallback((width: number) => {
      try {
        chrome.storage?.sync?.set({ geminiEditInputWidth: width });
      } catch {}
    }, []),
  });

  useEffect(() => {
    try {
      chrome.storage?.sync?.get(
        {
          deepseekTimelineScrollMode: 'flow',
          deepseekTimelineEnabled: false,
          dsHideFolderPanel: false,
          dsFolderItemFontSize: 13,
          dsFolderIconSize: 16,
          dsFolderPositionOffset: 0,
        },
        (res) => {
          const m = res?.deepseekTimelineScrollMode as ScrollMode;
          if (m === 'jump' || m === 'flow') setMode(m);
          setTimelineEnabled(!!res?.deepseekTimelineEnabled);
          setHideFolderPanel(!!res?.dsHideFolderPanel);
          setFolderFontSize(Number(res?.dsFolderItemFontSize) || 13);
          setFolderIconSize(Number(res?.dsFolderIconSize) || 16);
          setFolderPositionOffset(Number(res?.dsFolderPositionOffset) || 0);
        }
      );
    } catch {}

    fetchStarredMessages();
  }, [fetchStarredMessages]);

  const handleStarredClick = (url: string, turnId: string) => {
    const targetUrl = url.split('#')[0] + '#ds-turn-' + turnId;
    try {
      if (chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url: targetUrl });
      } else {
        window.open(targetUrl, '_blank');
      }
    } catch {
      window.open(targetUrl, '_blank');
    }
  };

  const handleRemoveStar = (conversationId: string, turnId: string) => {
    try {
      chrome.runtime?.sendMessage(
        {
          type: 'ds.starred.remove',
          payload: { conversationId, turnId },
        },
        (response) => {
          if (response && response.ok) {
            fetchStarredMessages();
          }
        }
      );
    } catch (e) {
      console.warn('Failed to remove star:', e);
    }
  };

  const isZh = language === 'zh';

  return (
    <div className="w-[360px] bg-background text-foreground flex flex-col max-h-[600px]">
      {/* Header */}
      <div className="bg-linear-to-br from-primary/10 via-accent/5 to-transparent border-b border-border/50 px-5 py-4 flex items-center justify-between backdrop-blur-sm shrink-0">
        <h1 className="text-xl font-bold bg-linear-to-r from-primary to-primary/70 bg-clip-text text-transparent">
          {t('extName')}
        </h1>
        <div className="flex items-center gap-1">
          <DarkModeToggle />
          <LanguageSwitcher />
        </div>
      </div>

      {/* Tabs Switcher */}
      <div className="flex border-b border-border/50 px-5 bg-muted/20 shrink-0">
        <button
          className={`flex-1 py-2.5 text-sm font-semibold border-b-2 transition-all ${
            activeTab === 'settings'
              ? 'border-primary text-primary font-bold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setActiveTab('settings')}
        >
          {isZh ? '基本设置' : 'Settings'}
        </button>
        <button
          className={`flex-1 py-2.5 text-sm font-semibold border-b-2 transition-all flex items-center justify-center gap-1.5 ${
            activeTab === 'bookmarks'
              ? 'border-primary text-primary font-bold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => {
            setActiveTab('bookmarks');
            fetchStarredMessages();
          }}
        >
          {isZh ? '书签收藏' : 'Bookmarks'}
          {starredMessages.length > 0 && (
            <span className="bg-primary text-primary-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-full">
              {starredMessages.length}
            </span>
          )}
        </button>
      </div>

      {/* Main Content Area */}
      <div className="p-5 overflow-y-auto flex-1 space-y-4 min-h-[300px]">
        {activeTab === 'settings' ? (
          <>
            {/* Scroll Mode */}
            <Card className="p-4 hover:shadow-lg transition-shadow">
              <CardTitle className="mb-3 text-xs uppercase">{t('scrollMode')}</CardTitle>
              <CardContent className="p-0">
                <div className="relative grid grid-cols-2 rounded-lg bg-secondary/50 p-1 gap-1">
                  <div
                    className="absolute top-1 bottom-1 w-[calc(50%-6px)] rounded-md bg-primary shadow-md pointer-events-none transition-all duration-300 ease-out"
                    style={{ left: mode === 'flow' ? '4px' : 'calc(50% + 2px)' }}
                  />
                  <button
                    className={`relative z-10 px-3 py-2 text-sm font-semibold rounded-md transition-all duration-200 ${
                      mode === 'flow'
                        ? 'text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                    onClick={() => {
                      setMode('flow');
                      apply('flow');
                    }}
                  >
                    {t('flow')}
                  </button>
                  <button
                    className={`relative z-10 px-3 py-2 text-sm font-semibold rounded-md transition-all duration-200 ${
                      mode === 'jump'
                        ? 'text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                    onClick={() => {
                      setMode('jump');
                      apply('jump');
                    }}
                  >
                    {t('jump')}
                  </button>
                </div>
              </CardContent>
            </Card>

            {/* Timeline Options */}
            <Card className="p-4 hover:shadow-lg transition-shadow">
              <CardTitle className="mb-4 text-xs uppercase">{t('timelineOptions')}</CardTitle>
              <CardContent className="p-0 space-y-4">
                <div className="flex items-center justify-between group">
                  <Label
                    htmlFor="enable-timeline"
                    className="cursor-pointer text-sm font-medium group-hover:text-primary transition-colors"
                  >
                    {isZh ? '启用自定义时间轴' : 'Enable Custom Timeline'}
                  </Label>
                  <Switch
                    id="enable-timeline"
                    checked={timelineEnabled}
                    onChange={(e) => {
                      setTimelineEnabled(e.target.checked);
                      apply(null, e.target.checked);
                    }}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Folder Panel Options */}
            <Card className="p-4 hover:shadow-lg transition-shadow">
              <CardTitle className="mb-4 text-xs uppercase">
                {isZh ? '文件夹面板设置' : 'Folder Settings'}
              </CardTitle>
              <CardContent className="p-0 space-y-4">
                {/* Hide folder panel switch */}
                <div className="flex items-center justify-between group">
                  <Label
                    htmlFor="hide-folder-panel"
                    className="cursor-pointer text-sm font-medium group-hover:text-primary transition-colors"
                  >
                    {isZh ? '隐藏文件夹面板' : 'Hide Folder Panel'}
                  </Label>
                  <Switch
                    id="hide-folder-panel"
                    checked={hideFolderPanel}
                    onChange={(e) => {
                      setHideFolderPanel(e.target.checked);
                      chrome.storage?.sync?.set({ dsHideFolderPanel: e.target.checked });
                    }}
                  />
                </div>

                {/* Folder Item Font Size */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">{isZh ? '字体大小' : 'Font Size'}</Label>
                    <span className="text-xs font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded">
                      {folderFontSize}px
                    </span>
                  </div>
                  <input
                    type="range"
                    min={12}
                    max={18}
                    step={1}
                    value={folderFontSize}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setFolderFontSize(val);
                      chrome.storage?.sync?.set({ dsFolderItemFontSize: val });
                    }}
                    className="w-full h-1.5 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary"
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>12px</span>
                    <span>18px</span>
                  </div>
                </div>

                {/* Folder Item Icon Size */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">{isZh ? '图标大小' : 'Icon Size'}</Label>
                    <span className="text-xs font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded">
                      {folderIconSize}px
                    </span>
                  </div>
                  <input
                    type="range"
                    min={14}
                    max={24}
                    step={1}
                    value={folderIconSize}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setFolderIconSize(val);
                      chrome.storage?.sync?.set({ dsFolderIconSize: val });
                    }}
                    className="w-full h-1.5 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary"
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>14px</span>
                    <span>24px</span>
                  </div>
                </div>

                {/* Folder Offset */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">
                      {isZh ? '侧边栏位置微调偏移' : 'Position Offset'}
                    </Label>
                    <span className="text-xs font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded">
                      {folderPositionOffset > 0 ? `+${folderPositionOffset}` : folderPositionOffset}{' '}
                      pt
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-50}
                    max={50}
                    step={1}
                    value={folderPositionOffset}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setFolderPositionOffset(val);
                      chrome.storage?.sync?.set({ dsFolderPositionOffset: val });
                    }}
                    className="w-full h-1.5 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary"
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>{isZh ? '向左 -50pt' : 'Left -50pt'}</span>
                    <span>{isZh ? '居中 0pt' : 'Center 0pt'}</span>
                    <span>{isZh ? '向右 50pt' : 'Right 50pt'}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Temporarily hidden
            <WidthSlider
              label={t('chatWidth')}
              value={chatWidthAdjuster.width}
              min={400}
              max={1400}
              step={50}
              narrowLabel={t('chatWidthNarrow')}
              wideLabel={t('chatWidthWide')}
              onChange={chatWidthAdjuster.handleChange}
              onChangeComplete={chatWidthAdjuster.handleChangeComplete}
            />

            <WidthSlider
              label={t('editInputWidth')}
              value={editInputWidthAdjuster.width}
              min={400}
              max={1200}
              step={50}
              narrowLabel={t('editInputWidthNarrow')}
              wideLabel={t('editInputWidthWide')}
              onChange={editInputWidthAdjuster.handleChange}
              onChangeComplete={editInputWidthAdjuster.handleChangeComplete}
            />
            */}

            {/* Reset Button */}
            <Button
              variant="outline"
              className="w-full group hover:border-primary/50"
              onClick={() => {
                apply(null, undefined, true);
              }}
            >
              <span className="group-hover:scale-105 transition-transform">
                {t('resetPosition')}
              </span>
            </Button>
          </>
        ) : (
          /* Bookmarks Tab Content */
          <div className="space-y-3">
            {starredMessages.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm space-y-2">
                <svg
                  className="w-12 h-12 mx-auto text-muted-foreground/45"
                  xmlns="http://www.w3.org/2000/svg"
                  height="24"
                  viewBox="0 -960 960 960"
                  width="24"
                  fill="currentColor"
                >
                  <path d="m354-287 126-76 126 77-33-144 111-96-146-13-58-136-58 135-146 13 111 97-33 143ZM233-120l65-281L80-590l288-25 112-265 112 265 288 25-218 189 65 281-247-149-247 149Z" />
                </svg>
                <div>
                  {isZh
                    ? '暂无书签收藏。可以在对话中长按时间轴节点来打星收藏消息！'
                    : 'No bookmarked messages. Long-press any node on the conversation timeline to star it!'}
                </div>
              </div>
            ) : (
              <div className="space-y-3 pr-1">
                {starredMessages.map((msg) => (
                  <Card
                    key={`${msg.conversationId}-${msg.turnId}`}
                    className="p-3.5 hover:shadow-md hover:border-primary/30 transition-all cursor-pointer group relative"
                    onClick={() => handleStarredClick(msg.conversationUrl, msg.turnId)}
                  >
                    <div className="flex justify-between items-start gap-2 mb-1.5">
                      <div className="text-xs font-bold text-primary truncate max-w-[210px]">
                        {msg.conversationTitle || (isZh ? '未命名对话' : 'Untitled Chat')}
                      </div>
                      <span className="text-[10px] text-muted-foreground font-medium shrink-0">
                        {new Date(msg.starredAt).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-sm text-foreground/80 line-clamp-2 break-words pr-5">
                      {msg.content}
                    </p>
                    <button
                      className="absolute right-2.5 bottom-2.5 text-muted-foreground hover:text-destructive p-1 rounded transition-colors opacity-0 group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveStar(msg.conversationId, msg.turnId);
                      }}
                      title={isZh ? '取消收藏' : 'Remove Star'}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        height="14"
                        viewBox="0 -960 960 960"
                        width="14"
                        fill="currentColor"
                      >
                        <path d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v500h400v-500ZM360-280h80v-340h-80v340Zm160 0h80v-340h-80v340ZM280-720v500-500Z" />
                      </svg>
                    </button>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="bg-linear-to-br from-secondary/30 via-accent/10 to-transparent border-t border-border/50 px-5 py-4 flex items-center justify-between backdrop-blur-sm shrink-0">
        <span className="text-xs text-muted-foreground font-medium">{t('starProject')}</span>
        <a
          href="https://github.com/Craig-Akutagawa/DeepSeek-Voyager"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-xs font-semibold transition-all hover:shadow-lg hover:scale-105 active:scale-95"
          title={t('starProject')}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 005.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8 8 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          <span>Star</span>
        </a>
      </div>
    </div>
  );
}
