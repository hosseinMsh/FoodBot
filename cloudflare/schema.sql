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
    created_at REAL,
    updated_at REAL
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
