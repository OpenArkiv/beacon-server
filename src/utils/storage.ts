import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import type { DeviceEntity } from '../types/index.js';

interface StoredChat extends DeviceEntity {
  timestamp: string;
  whistleblow?: boolean;
}

class ChatStorage {
  private db: Database.Database;

  constructor() {
    // Ensure data directory exists
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Initialize database
    const dbPath = path.join(dataDir, 'beacon.db');
    this.db = new Database(dbPath);

    // Create table if not exists
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chats (
        nodeId TEXT PRIMARY KEY,
        devicePub TEXT,
        whistleblow INTEGER DEFAULT 0,
        timestamp TEXT,
        data JSON
      )
    `);

    // Create index on whistleblow for faster retrieval
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_chats_whistleblow ON chats(whistleblow)
    `);
  }

  /**
   * Store a chat message
   */
  storeChat(entity: DeviceEntity, whistleblow: boolean = false): void {
    const timestamp = new Date().toISOString();
    const storedChat: StoredChat = {
      ...entity,
      timestamp,
      whistleblow,
    };

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO chats (nodeId, devicePub, whistleblow, timestamp, data)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      entity.nodeId,
      entity.devicePub,
      whistleblow ? 1 : 0,
      timestamp,
      JSON.stringify(storedChat)
    );
  }

  /**
   * Get all chats
   */
  getAllChats(): StoredChat[] {
    const stmt = this.db.prepare('SELECT data FROM chats ORDER BY timestamp DESC');
    const rows = stmt.all() as { data: string }[];
    return rows.map(row => JSON.parse(row.data));
  }

  /**
   * Get all whistleblow messages
   */
  getWhistleblowMessages(): StoredChat[] {
    const stmt = this.db.prepare('SELECT data FROM chats WHERE whistleblow = 1 ORDER BY timestamp DESC');
    const rows = stmt.all() as { data: string }[];
    return rows.map(row => JSON.parse(row.data));
  }

  /**
   * Get a specific chat by ID
   */
  getChatById(id: string): StoredChat | undefined {
    const stmt = this.db.prepare('SELECT data FROM chats WHERE nodeId = ?');
    const row = stmt.get(id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }

  /**
   * Clear all chats (useful for testing)
   */
  clearAll(): void {
    this.db.prepare('DELETE FROM chats').run();
  }
}

// Singleton instance
export const chatStorage = new ChatStorage();

