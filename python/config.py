import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env file
BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

# Messenger Platform: "telegram" or "bale" (default: "telegram")
PLATFORM = os.getenv("PLATFORM", "telegram").strip().lower()

BOT_TOKEN = os.getenv("BOT_TOKEN", "").strip()

# Base URLs for Telegram and Bale Bot APIs
# Telegram: https://api.telegram.org/bot
# Bale:     https://tapi.bale.ai/bot
DEFAULT_BASE_URL = (
    "https://tapi.bale.ai/bot" if PLATFORM == "bale" else "https://api.telegram.org/bot"
)
DEFAULT_BASE_FILE_URL = (
    "https://tapi.bale.ai/file/bot" if PLATFORM == "bale" else "https://api.telegram.org/file/bot"
)

BOT_API_BASE_URL = os.getenv("BOT_API_BASE_URL", DEFAULT_BASE_URL).strip()
BOT_API_BASE_FILE_URL = os.getenv("BOT_API_BASE_FILE_URL", DEFAULT_BASE_FILE_URL).strip()

SAMAD_BASE_URL = os.getenv("SAMAD_BASE_URL", "https://setad.dining.sharif.edu/").strip()
if not SAMAD_BASE_URL.endswith("/"):
    SAMAD_BASE_URL += "/"

SAMAD_BASIC_AUTH = os.getenv(
    "SAMAD_BASIC_AUTH",
    "Basic c2FtYWQtbW9iaWxlOnNhbWFkLW1vYmlsZS1zZWNyZXQ="
).strip()

DATABASE_PATH = os.getenv("DATABASE_PATH", str(BASE_DIR / "storage.db"))

# Optional default credentials
DEFAULT_USERNAME = os.getenv("DEFAULT_USERNAME", "").strip()
DEFAULT_PASSWORD = os.getenv("DEFAULT_PASSWORD", "").strip()

# Verification / SSL settings
VERIFY_SSL = os.getenv("VERIFY_SSL", "False").lower() in ("true", "1", "yes")

# Proxy settings (for connecting to Telegram API in Iran; usually not needed for Bale)
PROXY_URL = os.getenv("PROXY_URL", "").strip()

# Sharif Central Payment Gateway URL (Direct dining recharge)
PAY_SHARIF_URL = os.getenv("PAY_SHARIF_URL", "https://pay.sharif.ir").strip()

# Optional Telegram Mini App URL (e.g. Cloudflare Worker URL https://<worker>.workers.dev/app)
MINIAPP_URL = os.getenv("MINIAPP_URL", "").strip()
