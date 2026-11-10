import { User } from "./types";

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

export async function deleteUser(db: D1Database, telegramId: number): Promise<void> {
  await db.prepare("DELETE FROM users WHERE telegram_id = ?").bind(telegramId).run();
}
