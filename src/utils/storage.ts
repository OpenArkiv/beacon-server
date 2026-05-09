import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import type { DeviceEntity } from '../types/index.js';

interface StoredChat extends DeviceEntity {
  timestamp: string;
}

class ChatStorage {
  private db: Database.Database;

  constructor() {
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const dbPath = path.join(dataDir, 'beacon.db');
    this.db = new Database(dbPath);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chats (
        nodeId TEXT PRIMARY KEY,
        devicePub TEXT,
        timestamp TEXT,
        data JSON
      )
    `);
  }

  storeChat(entity: DeviceEntity): void {
    const timestamp = new Date().toISOString();
    const storedChat: StoredChat = {
      ...entity,
      timestamp,
    };

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO chats (nodeId, devicePub, timestamp, data)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(
      entity.nodeId,
      entity.devicePub,
      timestamp,
      JSON.stringify(storedChat)
    );
  }

  getAllChats(): StoredChat[] {
    const stmt = this.db.prepare('SELECT data FROM chats ORDER BY timestamp DESC');
    const rows = stmt.all() as { data: string }[];
    return rows.map(row => JSON.parse(row.data));
  }

  getChatById(id: string): StoredChat | undefined {
    const stmt = this.db.prepare('SELECT data FROM chats WHERE nodeId = ?');
    const row = stmt.get(id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }

  clearAll(): void {
    this.db.prepare('DELETE FROM chats').run();
  }
}

export const chatStorage = new ChatStorage();
