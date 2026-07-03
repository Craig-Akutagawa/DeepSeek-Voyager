/* Background service worker - handles cross-origin image fetch for packaging, popup opening, and starred messages */

const STORAGE_KEY_STARRED_MESSAGES = 'dsTimelineStarredMessages';

interface StarredMessage {
  conversationId: string;
  turnId: string;
  content: string;
  starredAt: number;
  conversationUrl?: string;
  title?: string;
}

interface StarredMessagesData {
  messages: Record<string, StarredMessage[]>;
}

class StarredMessagesManager {
  private operationQueue: Promise<unknown> = Promise.resolve();

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const promise = this.operationQueue.then(operation, operation);
    this.operationQueue = promise.catch(() => {});
    return promise;
  }

  private async getFromStorage(): Promise<StarredMessagesData> {
    try {
      const result = await chrome.storage.local.get([STORAGE_KEY_STARRED_MESSAGES]);
      const starred = result[STORAGE_KEY_STARRED_MESSAGES] as any;
      if (
        starred &&
        typeof starred === 'object' &&
        starred.messages &&
        typeof starred.messages === 'object'
      ) {
        return starred as StarredMessagesData;
      }
      return { messages: {} };
    } catch (error) {
      console.error('[Background] Failed to get starred messages:', error);
      return { messages: {} };
    }
  }

  private async saveToStorage(data: StarredMessagesData): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEY_STARRED_MESSAGES]: data });
  }

  async addStarredMessage(message: StarredMessage): Promise<boolean> {
    return this.serialize(async () => {
      const data = await this.getFromStorage();

      if (!data.messages[message.conversationId]) {
        data.messages[message.conversationId] = [];
      }

      const exists = data.messages[message.conversationId].some((m) => m.turnId === message.turnId);

      if (!exists) {
        const MAX_CONTENT_LENGTH = 60;
        const truncatedMessage: StarredMessage = {
          ...message,
          content:
            message.content.length > MAX_CONTENT_LENGTH
              ? message.content.slice(0, MAX_CONTENT_LENGTH) + '...'
              : message.content,
        };
        data.messages[message.conversationId].push(truncatedMessage);
        await this.saveToStorage(data);
        return true;
      }
      return false;
    });
  }

  async removeStarredMessage(conversationId: string, turnId: string): Promise<boolean> {
    return this.serialize(async () => {
      const data = await this.getFromStorage();

      if (data.messages[conversationId]) {
        const initialLength = data.messages[conversationId].length;
        data.messages[conversationId] = data.messages[conversationId].filter(
          (m) => m.turnId !== turnId
        );

        if (data.messages[conversationId].length < initialLength) {
          if (data.messages[conversationId].length === 0) {
            delete data.messages[conversationId];
          }

          await this.saveToStorage(data);
          return true;
        }
      }
      return false;
    });
  }

  async getAllStarredMessages(): Promise<StarredMessagesData> {
    return this.getFromStorage();
  }

  async getStarredMessagesForConversation(conversationId: string): Promise<StarredMessage[]> {
    const data = await this.getFromStorage();
    return data.messages[conversationId] || [];
  }

  async isMessageStarred(conversationId: string, turnId: string): Promise<boolean> {
    const messages = await this.getStarredMessagesForConversation(conversationId);
    return messages.some((m) => m.turnId === turnId);
  }

  async reconcileConversationIds(
    targetConversationId: string,
    sourceConversationIds: string[],
    conversationUrl?: string
  ): Promise<StarredMessage[]> {
    return this.serialize(async () => {
      const data = await this.getFromStorage();
      const uniqueConversationIds = Array.from(
        new Set([targetConversationId, ...sourceConversationIds])
      ).filter(Boolean);

      const mergedMessages = new Map<string, StarredMessage>();

      for (const conversationId of uniqueConversationIds) {
        const messages = data.messages[conversationId] || [];
        for (const message of messages) {
          const normalizedMessage: StarredMessage = {
            ...message,
            conversationId: targetConversationId,
            conversationUrl: conversationUrl || message.conversationUrl,
          };
          const existing = mergedMessages.get(message.turnId);
          if (!existing || normalizedMessage.starredAt >= existing.starredAt) {
            mergedMessages.set(message.turnId, normalizedMessage);
          }
        }
      }

      if (mergedMessages.size > 0) {
        data.messages[targetConversationId] = Array.from(mergedMessages.values());
      } else {
        delete data.messages[targetConversationId];
      }

      for (const conversationId of uniqueConversationIds) {
        if (conversationId !== targetConversationId) {
          delete data.messages[conversationId];
        }
      }

      await this.saveToStorage(data);
      return data.messages[targetConversationId] || [];
    });
  }
}

const starredMessagesManager = new StarredMessagesManager();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      // Handle popup opening request
      if (message && message.type === 'gv.openPopup') {
        try {
          await chrome.action.openPopup();
          sendResponse({ ok: true });
        } catch (e: any) {
          console.warn('[GV] Failed to open popup programmatically:', e);
          sendResponse({ ok: false, error: String(e?.message || e) });
        }
        return;
      }

      // Handle starred messages operations
      if (message && message.type && message.type.startsWith('ds.starred.')) {
        switch (message.type) {
          case 'ds.starred.add': {
            const added = await starredMessagesManager.addStarredMessage(message.payload);
            sendResponse({ ok: true, added });
            return;
          }
          case 'ds.starred.remove': {
            const removed = await starredMessagesManager.removeStarredMessage(
              message.payload.conversationId,
              message.payload.turnId
            );
            sendResponse({ ok: true, removed });
            return;
          }
          case 'ds.starred.getAll': {
            const data = await starredMessagesManager.getAllStarredMessages();
            sendResponse({ ok: true, data });
            return;
          }
          case 'ds.starred.getForConversation': {
            const messages = await starredMessagesManager.getStarredMessagesForConversation(
              message.payload.conversationId
            );
            sendResponse({ ok: true, messages });
            return;
          }
          case 'ds.starred.isStarred': {
            const isStarred = await starredMessagesManager.isMessageStarred(
              message.payload.conversationId,
              message.payload.turnId
            );
            sendResponse({ ok: true, isStarred });
            return;
          }
          case 'ds.starred.reconcileConversationIds': {
            const messages = await starredMessagesManager.reconcileConversationIds(
              message.payload.targetConversationId,
              Array.isArray(message.payload.sourceConversationIds)
                ? message.payload.sourceConversationIds
                : [],
              typeof message.payload.conversationUrl === 'string'
                ? message.payload.conversationUrl
                : undefined
            );
            sendResponse({ ok: true, messages });
            return;
          }
        }
      }

      // Handle image fetch
      if (!message || message.type !== 'gv.fetchImage') return;
      const url = String(message.url || '');
      if (!/^https?:\/\//i.test(url)) {
        sendResponse({ ok: false, error: 'invalid_url' });
        return;
      }
      const resp = await fetch(url, { credentials: 'include', mode: 'cors' as RequestMode });
      if (!resp.ok) {
        sendResponse({ ok: false, status: resp.status });
        return;
      }
      const contentType = resp.headers.get('Content-Type') || '';
      const ab = await resp.arrayBuffer();
      const b64 = arrayBufferToBase64(ab);
      sendResponse({ ok: true, contentType, base64: b64 });
    } catch (e: any) {
      try {
        sendResponse({ ok: false, error: String(e?.message || e) });
      } catch {}
    }
  })();
  return true; // keep channel open for async sendResponse
});

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
