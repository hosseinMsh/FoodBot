import time
from typing import Optional, Dict, Any
import aiosqlite
from config import DATABASE_PATH


async def init_db():
    """Initializes the database schema."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS users (
                telegram_id INTEGER PRIMARY KEY,
                username TEXT,
                password TEXT,
                access_token TEXT,
                refresh_token TEXT,
                token_expires_at REAL,
                selected_self_id INTEGER,
                selected_self_name TEXT,
                full_name TEXT,
                created_at REAL,
                updated_at REAL
            )
        """)
        await db.commit()


async def get_user(telegram_id: int) -> Optional[Dict[str, Any]]:
    """Retrieves user data by Telegram ID."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM users WHERE telegram_id = ?", (telegram_id,)
        ) as cursor:
            row = await cursor.fetchone()
            if row:
                return dict(row)
            return None


async def save_user_tokens(
    telegram_id: int,
    username: str,
    access_token: str,
    refresh_token: str,
    expires_in: int,
    password: Optional[str] = None,
    full_name: Optional[str] = None,
):
    """Saves or updates user authentication tokens."""
    now = time.time()
    expires_at = now + expires_in

    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute(
            """
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
            """,
            (
                telegram_id,
                username,
                password,
                access_token,
                refresh_token,
                expires_at,
                full_name,
                now,
                now,
            ),
        )
        await db.commit()


async def update_selected_self(telegram_id: int, self_id: int, self_name: str):
    """Updates user's preferred dining location (self)."""
    now = time.time()
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute(
            """
            UPDATE users
            SET selected_self_id = ?, selected_self_name = ?, updated_at = ?
            WHERE telegram_id = ?
            """,
            (self_id, self_name, now, telegram_id),
        )
        await db.commit()


async def update_user_profile(telegram_id: int, full_name: str):
    """Updates user's full name."""
    now = time.time()
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute(
            """
            UPDATE users
            SET full_name = ?, updated_at = ?
            WHERE telegram_id = ?
            """,
            (full_name, now, telegram_id),
        )
        await db.commit()


async def delete_user(telegram_id: int):
    """Removes user from database (logout)."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute("DELETE FROM users WHERE telegram_id = ?", (telegram_id,))
        await db.commit()
