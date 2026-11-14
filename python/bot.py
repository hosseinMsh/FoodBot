import argparse
import asyncio
import logging
import sys
from telegram import BotCommand, Update
from telegram.request import HTTPXRequest
from telegram.ext import (
    Application,
    CommandHandler,
    MessageHandler,
    CallbackQueryHandler,
    filters,
)

from config import (
    PLATFORM,
    BOT_TOKEN,
    BOT_API_BASE_URL,
    BOT_API_BASE_FILE_URL,
    PROXY_URL,
    MINIAPP_URL,
)
import database

from handlers.common import (
    BTN_TODAY,
    BTN_REMAINING,
    BTN_NEXT_WEEK,
    BTN_BUY,
    BTN_CREDIT,
    BTN_CHARGE,
    BTN_SELF,
    BTN_PROFILE,
)

from handlers.auth import (
    start_command,
    logout_command,
    profile_command,
    miniapp_command,
    get_login_conversation_handler,
)

from handlers.today_food import (
    today_food_command,
    forget_code_callback,
)

from handlers.next_week import (
    next_week_food_command,
    all_selfs_overview_callback,
    all_selfs_day_callback,
    browse_all_selfs_callback,
    view_self_menu_callback,
)

from handlers.remaining_week import (
    remaining_week_food_command,
    cancel_meal_callback,
)

from handlers.credit import (
    credit_balance_command,
    increase_credit_command,
    recharge_credit_callback,
)

from handlers.settings import (
    select_self_command,
    set_self_callback,
)

from handlers.buy_food import (
    buy_food_command,
    buy_weekly_start_callback,
    buy_view_day_callback,
    do_reserve_callback,
    do_cancel_callback,
    daily_sales_list_callback,
    buy_daily_callback,
)

# Configure logging
logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger("FoodBot")


async def post_init(application: Application):
    """Initializes database and sets up Telegram bot commands menu."""
    await database.init_db()

    commands = [
        BotCommand("start", "شروع و منوی اصلی"),
        BotCommand("app", "📱 مینی‌اپ صمد"),
        BotCommand("today", "دریافت غذای امروز و بارکد"),
        BotCommand("nextweek", "برنامه غذایی هفته آینده"),
        BotCommand("remaining", "غذاهای رزرو مانده هفته جاری"),
        BotCommand("credit", "مانده اعتبار کیف پول"),
        BotCommand("charge", "افزایش اعتبار آنلاین"),
        BotCommand("buy", "خرید و رزرو غذا"),
        BotCommand("self", "انتخاب سلف غذاخوری"),
        BotCommand("profile", "مشخصات حساب کاربری"),
        BotCommand("login", "ورود به سامانه صمد"),
        BotCommand("logout", "خروج از حساب"),
    ]
    try:
        await application.bot.set_my_commands(commands)
        logger.info("Bot commands registered successfully.")
    except Exception as e:
        logger.warning(f"Failed to register bot commands: {e}")

    if MINIAPP_URL:
        try:
            from telegram import MenuButtonWebApp, WebAppInfo
            await application.bot.set_chat_menu_button(
                menu_button=MenuButtonWebApp(
                    text="🍽 مینی‌اپ صمد",
                    web_app=WebAppInfo(url=MINIAPP_URL),
                )
            )
            logger.info(f"Chat menu button set to Mini App: {MINIAPP_URL}")
        except Exception as e:
            logger.warning(f"Failed to set chat menu button: {e}")


def parse_args():
    parser = argparse.ArgumentParser(description="FoodBot for Telegram and Bale")
    parser.add_argument(
        "--platform",
        choices=["telegram", "bale"],
        default=None,
        help="Messenger platform to use: 'telegram' or 'bale' (overrides PLATFORM in .env)",
    )
    return parser.parse_args()


def main():
    """Main entrypoint."""
    args = parse_args()
    platform = (args.platform if args.platform else PLATFORM).lower()

    if not BOT_TOKEN:
        logger.error(
            "BOT_TOKEN is not set! Please provide it in .env file or environment variable."
        )
        print(f"\n[!] خطا: توکن ربات {platform.upper()} (BOT_TOKEN) تنظیم نشده است.")
        print("لطفاً فایل .env را ویرایش کرده و BOT_TOKEN را قرار دهید.\n")
        sys.exit(1)

    # Determine base URLs
    base_url = BOT_API_BASE_URL
    base_file_url = BOT_API_BASE_FILE_URL
    if args.platform:
        base_url = (
            "https://tapi.bale.ai/bot" if platform == "bale" else "https://api.telegram.org/bot"
        )
        base_file_url = (
            "https://tapi.bale.ai/file/bot" if platform == "bale" else "https://api.telegram.org/file/bot"
        )

    logger.info(f"Starting FoodBot on platform [{platform.upper()}] with API URL: {base_url}")

    builder = (
        Application.builder()
        .token(BOT_TOKEN)
        .base_url(base_url)
        .base_file_url(base_file_url)
        .post_init(post_init)
    )

    if PROXY_URL and (platform == "telegram" or PROXY_URL.startswith("http") or PROXY_URL.startswith("socks")):
        logger.info(f"Connecting to {platform.upper()} API via proxy: {PROXY_URL}")
        req = HTTPXRequest(
            proxy=PROXY_URL,
            connection_pool_size=16,
            read_timeout=30.0,
            write_timeout=30.0,
            connect_timeout=20.0,
        )
        builder = builder.request(req).get_updates_request(req)
    else:
        req = HTTPXRequest(
            connection_pool_size=16,
            read_timeout=30.0,
            write_timeout=30.0,
            connect_timeout=20.0,
        )
        builder = builder.request(req).get_updates_request(req)

    app = builder.build()

    # Conversation handler for login
    app.add_handler(get_login_conversation_handler())

    # Basic Commands
    app.add_handler(CommandHandler("start", start_command))
    app.add_handler(CommandHandler(["app", "miniapp"], miniapp_command))
    app.add_handler(CommandHandler("logout", logout_command))
    app.add_handler(CommandHandler("profile", profile_command))
    app.add_handler(CommandHandler("whoami", profile_command))

    # Feature 1: دریافت غذای روز
    app.add_handler(CommandHandler("today", today_food_command))
    app.add_handler(MessageHandler(filters.Regex(f"^{BTN_TODAY}$"), today_food_command))

    # Feature 2: دریافت لیست غذاهای هفته بعدی
    app.add_handler(CommandHandler("nextweek", next_week_food_command))
    app.add_handler(
        MessageHandler(filters.Regex(f"^{BTN_NEXT_WEEK}$"), next_week_food_command)
    )

    # Feature 3: دریافت غذاهای رزرو مانده هفته
    app.add_handler(CommandHandler("remaining", remaining_week_food_command))
    app.add_handler(
        MessageHandler(filters.Regex(f"^{BTN_REMAINING}$"), remaining_week_food_command)
    )

    # Feature 4 & 5: مانده اعتبار و افزایش اعتبار
    app.add_handler(CommandHandler("credit", credit_balance_command))
    app.add_handler(
        MessageHandler(filters.Regex(f"^{BTN_CREDIT}$"), credit_balance_command)
    )

    app.add_handler(CommandHandler("charge", increase_credit_command))
    app.add_handler(
        MessageHandler(filters.Regex(f"^{BTN_CHARGE}$"), increase_credit_command)
    )

    # Feature 6: خرید غذا
    app.add_handler(CommandHandler("buy", buy_food_command))
    app.add_handler(MessageHandler(filters.Regex(f"^{BTN_BUY}$"), buy_food_command))

    # Settings: سلف و پروفایل
    app.add_handler(CommandHandler("self", select_self_command))
    app.add_handler(MessageHandler(filters.Regex(f"^{BTN_SELF}$"), select_self_command))
    app.add_handler(
        MessageHandler(filters.Regex(f"^{BTN_PROFILE}$"), profile_command)
    )

    # Callback Query Handlers
    app.add_handler(
        CallbackQueryHandler(forget_code_callback, pattern=r"^forget_code_")
    )
    app.add_handler(
        CallbackQueryHandler(cancel_meal_callback, pattern=r"^cancel_meal_")
    )
    app.add_handler(
        CallbackQueryHandler(recharge_credit_callback, pattern=r"^recharge_credit$")
    )
    app.add_handler(
        CallbackQueryHandler(credit_balance_command, pattern=r"^check_balance_now$")
    )
    app.add_handler(
        CallbackQueryHandler(select_self_command, pattern=r"^change_self$")
    )
    app.add_handler(CallbackQueryHandler(set_self_callback, pattern=r"^set_self_"))
    app.add_handler(
        CallbackQueryHandler(
            buy_weekly_start_callback,
            pattern=r"^(start_weekly_reserve|buy_weekly_start)$",
        )
    )
    app.add_handler(
        CallbackQueryHandler(buy_view_day_callback, pattern=r"^buy_view_day_")
    )
    app.add_handler(
        CallbackQueryHandler(
            all_selfs_overview_callback, pattern=r"^all_selfs_overview$"
        )
    )
    app.add_handler(
        CallbackQueryHandler(
            all_selfs_day_callback, pattern=r"^all_selfs_day_"
        )
    )
    app.add_handler(
        CallbackQueryHandler(
            browse_all_selfs_callback, pattern=r"^browse_all_selfs$"
        )
    )
    app.add_handler(
        CallbackQueryHandler(
            view_self_menu_callback, pattern=r"^view_self_menu_"
        )
    )
    app.add_handler(CallbackQueryHandler(do_reserve_callback, pattern=r"^do_reserve_"))
    app.add_handler(CallbackQueryHandler(do_cancel_callback, pattern=r"^do_cancel_"))
    app.add_handler(
        CallbackQueryHandler(
            daily_sales_list_callback, pattern=r"^daily_sales_list$"
        )
    )
    app.add_handler(CallbackQueryHandler(buy_daily_callback, pattern=r"^buy_daily_"))

    allowed_updates = (
        ["message", "callback_query", "edited_message"]
        if platform == "bale"
        else Update.ALL_TYPES
    )
    logger.info(f"Bot ({platform.upper()}) is starting polling...")
    app.run_polling(allowed_updates=allowed_updates)


if __name__ == "__main__":
    main()
