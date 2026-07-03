import { eventBus } from './EventBus';
import type { StarredMessage, StarredMessagesData } from './starredTypes';

export class StarredMessagesService {
  private static async sendMessage<T>(type: string, payload?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, payload }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response || !response.ok) {
          reject(new Error(response?.error || 'Operation failed'));
          return;
        }
        resolve(response as T);
      });
    });
  }

  static async getAllStarredMessages(): Promise<StarredMessagesData> {
    try {
      const response = await this.sendMessage<{ ok: boolean; data: StarredMessagesData }>(
        'ds.starred.getAll',
      );
      return response.data || { messages: {} };
    } catch (error) {
      console.error('[StarredMessagesService] Failed to get starred messages:', error);
      return { messages: {} };
    }
  }

  static async getStarredMessagesForConversation(
    conversationId: string,
  ): Promise<StarredMessage[]> {
    try {
      const response = await this.sendMessage<{ ok: boolean; messages: StarredMessage[] }>(
        'ds.starred.getForConversation',
        { conversationId },
      );
      return response.messages || [];
    } catch (error) {
      console.error('[StarredMessagesService] Failed to get starred messages:', error);
      return [];
    }
  }

  static async addStarredMessage(message: StarredMessage): Promise<void> {
    try {
      const response = await this.sendMessage<{ ok: boolean; added: boolean }>(
        'ds.starred.add',
        message,
      );

      if (response.added) {
        eventBus.emit('starred:added', {
          conversationId: message.conversationId,
          turnId: message.turnId,
        });
        this.updateLegacyStorage(message.conversationId, message.turnId, 'add');
      }
    } catch (error) {
      console.error('[StarredMessagesService] Failed to add starred message:', error);
    }
  }

  static async removeStarredMessage(conversationId: string, turnId: string): Promise<void> {
    try {
      const response = await this.sendMessage<{ ok: boolean; removed: boolean }>(
        'ds.starred.remove',
        { conversationId, turnId },
      );

      if (response.removed) {
        eventBus.emit('starred:removed', {
          conversationId,
          turnId,
        });
        this.updateLegacyStorage(conversationId, turnId, 'remove');
      }
    } catch (error) {
      console.error('[StarredMessagesService] Failed to remove starred message:', error);
    }
  }

  private static updateLegacyStorage(
    conversationId: string,
    turnId: string,
    action: 'add' | 'remove',
  ): void {
    try {
      const key = `deepseekTimelineStars:${conversationId}`;
      const raw = localStorage.getItem(key);
      let ids: string[] = [];

      if (raw) {
        try {
          ids = JSON.parse(raw);
          if (!Array.isArray(ids)) ids = [];
        } catch {
          ids = [];
        }
      }

      if (action === 'add') {
        if (!ids.includes(turnId)) {
          ids.push(turnId);
        }
      } else {
        ids = ids.filter((id) => id !== turnId);
      }

      localStorage.setItem(key, JSON.stringify(ids));
    } catch (error) {
      console.debug('[StarredMessagesService] Failed to update legacy storage:', error);
    }
  }

  static async isMessageStarred(conversationId: string, turnId: string): Promise<boolean> {
    const messages = await this.getStarredMessagesForConversation(conversationId);
    return messages.some((m) => m.turnId === turnId);
  }

  static async getAllStarredMessagesSorted(): Promise<StarredMessage[]> {
    const data = await this.getAllStarredMessages();
    const allMessages: StarredMessage[] = [];

    Object.values(data.messages).forEach((messages) => {
      allMessages.push(...messages);
    });

    return allMessages.sort((a, b) => b.starredAt - a.starredAt);
  }

  static async reconcileConversationIds(
    targetConversationId: string,
    sourceConversationIds: string[],
    conversationUrl: string,
  ): Promise<StarredMessage[]> {
    try {
      const response = await this.sendMessage<{ ok: boolean; messages: StarredMessage[] }>(
        'ds.starred.reconcileConversationIds',
        {
          targetConversationId,
          sourceConversationIds,
          conversationUrl,
        },
      );
      return response.messages || [];
    } catch (error) {
      console.error('[StarredMessagesService] Failed to reconcile starred messages:', error);
      return [];
    }
  }
}
