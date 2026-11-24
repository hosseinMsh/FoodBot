-- Cloudflare D1 Database Schema for FoodBot

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
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

CREATE TABLE IF NOT EXISTS favorite_foods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER NOT NULL,
    food_name TEXT NOT NULL,
    created_at REAL,
    UNIQUE(telegram_id, food_name)
);

CREATE INDEX IF NOT EXISTS idx_fav_user ON favorite_foods(telegram_id);
