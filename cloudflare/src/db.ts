import { User, FavoriteFood } from "./types";

export async function getUser(db: D1Database, telegramId: number): Promise<User | null> {
  const result = await db
    .prepare("SELECT * FROM users WHERE telegram_id = ?")
    .bind(telegramId)
    .first<User>();
  return result || null;
}

export async function saveUserTokens(
  db: D1Database,
  telegramId: number,
  username: string,
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
  password?: string,
  fullName?: string
): Promise<void> {
  const now = Date.now() / 1000;
  const expiresAt = now + expiresIn;

  await db
    .prepare(
      `
      INSERT INTO users (
        telegram_id, username, password, access_token, refresh_token,
        token_expires_at, full_name, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        username = excluded.username,
        password = COALESCE(excluded.password, users.password),
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        token_expires_at = excluded.token_expires_at,
        full_name = COALESCE(excluded.full_name, users.full_name),
        updated_at = excluded.updated_at
      `
    )
    .bind(
      telegramId,
      username,
      password || null,
      accessToken,
      refreshToken,
      expiresAt,
      fullName || null,
      now,
      now
    )
    .run();
}

export async function updateSelectedSelf(
  db: D1Database,
  telegramId: number,
  selfId: number,
  selfName: string
): Promise<void> {
  const now = Date.now() / 1000;
  await db
    .prepare(
      "UPDATE users SET selected_self_id = ?, selected_self_name = ?, updated_at = ? WHERE telegram_id = ?"
    )
    .bind(selfId, selfName, now, telegramId)
    .run();
}

export async function updateUserProfile(
  db: D1Database,
  telegramId: number,
  fullName: string
): Promise<void> {
  const now = Date.now() / 1000;
  await db
    .prepare("UPDATE users SET full_name = ?, updated_at = ? WHERE telegram_id = ?")
    .bind(fullName, now, telegramId)
    .run();
}

export async function getUserByUsername(db: D1Database, username: string): Promise<User | null> {
  const result = await db
    .prepare("SELECT * FROM users WHERE username = ?")
    .bind(username)
    .first<User>();
  return result || null;
}

export async function getAutoSendUsers(db: D1Database): Promise<User[]> {
  const result = await db
    .prepare(
      "SELECT * FROM users WHERE access_token IS NOT NULL AND access_token != '' AND (auto_send_code IS NULL OR auto_send_code != 0)"
    )
    .all<User>();
  return result.results || [];
}

export async function setAutoSendCode(
  db: D1Database,
  telegramId: number,
  enabled: boolean
): Promise<void> {
  const now = Date.now() / 1000;
  await db
    .prepare("UPDATE users SET auto_send_code = ?, updated_at = ? WHERE telegram_id = ?")
    .bind(enabled ? 1 : 0, now, telegramId)
    .run();
}

export async function deleteUser(db: D1Database, telegramId: number): Promise<void> {
  await db.prepare("DELETE FROM users WHERE telegram_id = ?").bind(telegramId).run();
  await db.prepare("DELETE FROM favorite_foods WHERE telegram_id = ?").bind(telegramId).run();
}

// ==========================================
// Favorite Foods Management
// ==========================================

export async function getFavoriteFoods(db: D1Database, telegramId: number): Promise<string[]> {
  await ensureTablesExist(db);
  const result = await db
    .prepare("SELECT food_name FROM favorite_foods WHERE telegram_id = ? ORDER BY id ASC")
    .bind(telegramId)
    .all<{ food_name: string }>();
  return (result.results || []).map((r) => r.food_name);
}

export async function addFavoriteFood(db: D1Database, telegramId: number, foodName: string): Promise<boolean> {
  await ensureTablesExist(db);
  const cleaned = foodName.trim();
  if (!cleaned) return false;
  const now = Date.now() / 1000;

  try {
    await db
      .prepare(
        "INSERT INTO favorite_foods (telegram_id, food_name, created_at) VALUES (?, ?, ?) ON CONFLICT(telegram_id, food_name) DO NOTHING"
      )
      .bind(telegramId, cleaned, now)
      .run();
    return true;
  } catch {
    return false;
  }
}

export async function removeFavoriteFood(db: D1Database, telegramId: number, foodName: string): Promise<boolean> {
  await ensureTablesExist(db);
  const cleaned = foodName.trim();
  try {
    await db
      .prepare("DELETE FROM favorite_foods WHERE telegram_id = ? AND food_name = ?")
      .bind(telegramId, cleaned)
      .run();
    return true;
  } catch {
    return false;
  }
}

// ==========================================
// Auto-Reservation Settings & Users
// ==========================================

export async function getAutoReserveUsers(db: D1Database): Promise<User[]> {
  await ensureTablesExist(db);
  const result = await db
    .prepare(
      "SELECT * FROM users WHERE access_token IS NOT NULL AND access_token != '' AND auto_reserve_enabled = 1"
    )
    .all<User>();
  return result.results || [];
}

export async function setAutoReserveSettings(
  db: D1Database,
  telegramId: number,
  enabled: boolean,
  scope: string = "ALL",
  days: string = "MON,TUE,WED"
): Promise<void> {
  await ensureTablesExist(db);
  const now = Date.now() / 1000;
  await db
    .prepare(
      "UPDATE users SET auto_reserve_enabled = ?, auto_reserve_scope = ?, auto_reserve_days = ?, updated_at = ? WHERE telegram_id = ?"
    )
    .bind(enabled ? 1 : 0, scope, days, now, telegramId)
    .run();
}

/**
 * Ensures table and columns exist in D1 (automatic seamless migration).
 */
let tablesEnsured = false;
export async function ensureTablesExist(db: D1Database): Promise<void> {
  if (tablesEnsured) return;
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS favorite_foods (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id INTEGER NOT NULL,
        food_name TEXT NOT NULL,
        created_at REAL,
        UNIQUE(telegram_id, food_name)
      );
      CREATE INDEX IF NOT EXISTS idx_fav_user ON favorite_foods(telegram_id);
    `);
  } catch {}

  // Try adding columns to users if missing
  try {
    await db.exec("ALTER TABLE users ADD COLUMN auto_reserve_enabled INTEGER DEFAULT 0;");
  } catch {}
  try {
    await db.exec("ALTER TABLE users ADD COLUMN auto_reserve_scope TEXT DEFAULT 'ALL';");
  } catch {}
  try {
    await db.exec("ALTER TABLE users ADD COLUMN auto_reserve_days TEXT DEFAULT 'MON,TUE,WED';");
  } catch {}

  tablesEnsured = true;
}
