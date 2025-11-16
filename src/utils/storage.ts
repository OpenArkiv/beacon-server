import type { DeviceEntity } from '../types/index.js';

interface StoredChat extends DeviceEntity {
  timestamp: string;
  whistleblow?: boolean;
}

class ChatStorage {
  private chats: Map<string, StoredChat> = new Map();
  private whistleblowMessages: StoredChat[] = [];

  /**
   * Store a chat message
   */
  storeChat(entity: DeviceEntity, whistleblow: boolean = false): void {
    const storedChat: StoredChat = {
      ...entity,
      timestamp: new Date().toISOString(),
      whistleblow,
    };

    // Store in main chats map
    this.chats.set(entity._id, storedChat);

    // If whistleblow, also store in whistleblow array
    if (whistleblow) {
      this.whistleblowMessages.push(storedChat);
    }
  }

  /**
   * Get all chats
   */
  getAllChats(): StoredChat[] {
    return Array.from(this.chats.values());
  }

  /**
   * Get all whistleblow messages
   */
  getWhistleblowMessages(): StoredChat[] {
    return [...this.whistleblowMessages];
  }

  /**
   * Get a specific chat by ID
   */
  getChatById(id: string): StoredChat | undefined {
    return this.chats.get(id);
  }

  /**
   * Clear all chats (useful for testing)
   */
  clearAll(): void {
    this.chats.clear();
    this.whistleblowMessages = [];
  }
}

// Singleton instance
export const chatStorage = new ChatStorage();

