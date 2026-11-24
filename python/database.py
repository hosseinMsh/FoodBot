import time
from typing import Optional, Dict, Any, List
import aiosqlite
from config import DATABASE_PATH


async def init_db():
    """Initializes the database schema with automatic migrations."""
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
                auto_send_code INTEGER DEFAULT 1,
                auto_reserve_enabled INTEGER DEFAULT 0,
                auto_reserve_scope TEXT DEFAULT 'ALL',
                auto_reserve_days TEXT DEFAULT 'MON,TUE,WED',
                created_at REAL,
                updated_at REAL
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS favorite_foods (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_id INTEGER NOT NULL,
                food_name TEXT NOT NULL,
                created_at REAL,
                UNIQUE(telegram_id, food_name)
            )
        """)
        await db.execute("CREATE INDEX IF NOT EXISTS idx_fav_user ON favorite_foods(telegram_id)")

        # Safe migrations for existing databases
        for col_def in [
            "auto_send_code INTEGER DEFAULT 1",
            "auto_reserve_enabled INTEGER DEFAULT 0",
            "auto_reserve_scope TEXT DEFAULT 'ALL'",
            "auto_reserve_days TEXT DEFAULT 'MON,TUE,WED'",
        ]:
            try:
                await db.execute(f"ALTER TABLE users ADD COLUMN {col_def}")
            except Exception:
                pass

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


async def get_auto_send_users() -> List[Dict[str, Any]]:
    """Returns all authenticated users with automatic daily delivery code enabled."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT * FROM users
            WHERE access_token IS NOT NULL AND access_token != ''
              AND (auto_send_code IS NULL OR auto_send_code != 0)
            """
        ) as cursor:
            rows = await cursor.fetchall()
            return [dict(r) for r in rows]


async def set_auto_send_code(telegram_id: int, enabled: bool):
    """Enables or disables automatic 11:00 AM daily meal code sending for a user."""
    now = time.time()
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute(
            "UPDATE users SET auto_send_code = ?, updated_at = ? WHERE telegram_id = ?",
            (1 if enabled else 0, now, telegram_id),
        )
        await db.commit()


async def delete_user(telegram_id: int):
    """Removes user from database (logout)."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute("DELETE FROM users WHERE telegram_id = ?", (telegram_id,))
        await db.execute("DELETE FROM favorite_foods WHERE telegram_id = ?", (telegram_id,))
        await db.commit()


# ==========================================
# Favorite Foods Management
# ==========================================

async def get_favorite_foods(telegram_id: int) -> List[str]:
    """Retrieves all favorite food keywords for a user."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        async with db.execute(
            "SELECT food_name FROM favorite_foods WHERE telegram_id = ? ORDER BY id ASC",
            (telegram_id,),
        ) as cursor:
            rows = await cursor.fetchall()
            return [r[0] for r in rows]


async def add_favorite_food(telegram_id: int, food_name: str) -> bool:
    """Adds a favorite food keyword for a user."""
    cleaned = food_name.strip()
    if not cleaned:
        return False
    now = time.time()
    try:
        async with aiosqlite.connect(DATABASE_PATH) as db:
            await db.execute(
                """
                INSERT INTO favorite_foods (telegram_id, food_name, created_at)
                VALUES (?, ?, ?)
                ON CONFLICT(telegram_id, food_name) DO NOTHING
                """,
                (telegram_id, cleaned, now),
            )
            await db.commit()
            return True
    except Exception:
        return False


async def remove_favorite_food(telegram_id: int, food_name: str) -> bool:
    """Removes a favorite food keyword for a user."""
    cleaned = food_name.strip()
    try:
        async with aiosqlite.connect(DATABASE_PATH) as db:
            await db.execute(
                "DELETE FROM favorite_foods WHERE telegram_id = ? AND food_name = ?",
                (telegram_id, cleaned),
            )
            await db.commit()
            return True
    except Exception:
        return False


# ==========================================
# Auto-Reservation Settings & Users
# ==========================================

async def get_auto_reserve_users() -> List[Dict[str, Any]]:
    """Retrieves all authenticated users with auto-reservation enabled."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT * FROM users
            WHERE access_token IS NOT NULL AND access_token != ''
              AND auto_reserve_enabled = 1
            """
        ) as cursor:
            rows = await cursor.fetchall()
            return [dict(r) for r in rows]


async def set_auto_reserve_settings(
    telegram_id: int,
    enabled: bool,
    scope: str = "ALL",
    days: str = "MON,TUE,WED",
):
    """Updates auto-reservation configuration for a user."""
    now = time.time()
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute(
            """
            UPDATE users
            SET auto_reserve_enabled = ?, auto_reserve_scope = ?, auto_reserve_days = ?, updated_at = ?
            WHERE telegram_id = ?
            """,
            (1 if enabled else 0, scope, days, now, telegram_id),
        )
        await db.commit()
