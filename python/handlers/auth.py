import base64
import io
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, ReplyKeyboardRemove
from telegram.ext import (
    ContextTypes,
    ConversationHandler,
    CommandHandler,
    MessageHandler,
    CallbackQueryHandler,
    filters,
)
import database
from config import DEFAULT_USERNAME, DEFAULT_PASSWORD
from samad_client import SamadClient, SamadAPIError
from handlers.common import (
    get_main_keyboard,
    BTN_PROFILE,
    check_authenticated,
)
from date_helper import format_toman

WAITING_USERNAME, WAITING_PASSWORD, WAITING_CAPTCHA = range(3)


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles /start command."""
    telegram_id = update.effective_user.id
    user = await database.get_user(telegram_id)

    if user and user.get("access_token"):
        full_name = user.get("full_name") or user.get("username") or "دانشجو"
        self_name = user.get("selected_self_name") or "انتخاب نشده"
        msg = (
            f"سلام <b>{full_name}</b> عزیز! خوش آمدید 🌹\n\n"
            f"🏛 سلف فعال: <b>{self_name}</b>\n\n"
            "از طریق دکمه‌های زیر می‌توانید سفارش‌ها، اعتبارات و برنامه‌های غذایی خود را مدیریت کنید."
        )
        await update.message.reply_html(msg, reply_markup=get_main_keyboard())
    else:
        msg = (
            "سلام! به <b>ربات تغذیه صمد (FoodBot)</b> خوش آمدید 🍽\n\n"
            "برای دسترسی به غذاها، رزرو و بررسی اعتبار، ابتدا باید با حساب سامانه صمد خود وارد شوید.\n\n"
            "هر کاربر می‌تواند با حساب دانشجویی اختصاصی خود وارد شود.\n\n"
            "👇 جهت ورود، روی دکمه زیر کلیک کنید یا دستور /login را ارسال نمایید:"
        )
        buttons = [
            [InlineKeyboardButton("🔐 ورود به حساب صمد", callback_data="start_login")]
        ]
        await update.message.reply_html(msg, reply_markup=InlineKeyboardMarkup(buttons))


async def login_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Starts the login flow."""
    msg_text = (
        "🔐 <b>ورود به سامانه صمد</b>\n\n"
        "لطفاً <b>شماره دانشجویی</b> (یا نام کاربری) خود را ارسال کنید:\n"
        "(برای انصراف /cancel را بفرستید)"
    )
    if update.callback_query:
        await update.callback_query.answer()
        await update.callback_query.message.reply_html(
            msg_text, reply_markup=ReplyKeyboardRemove()
        )
    elif update.message:
        await update.message.reply_html(
            msg_text, reply_markup=ReplyKeyboardRemove()
        )
    return WAITING_USERNAME


async def receive_username(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Receives student username."""
    username = update.message.text.strip()
    context.user_data["login_username"] = username

    await update.message.reply_html(
        f"شماره دانشجویی: <code>{username}</code>\n\n"
        "حالا لطفاً <b>رمز عبور</b> سامانه صمد را ارسال کنید:\n"
        "<i>(پیام حاوی رمز شما جهت حفظ امنیت بلافاصله از چت پاک خواهد شد)</i>"
    )
    return WAITING_PASSWORD


async def receive_password(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Receives password and fetches captcha image."""
    password = update.message.text.strip()
    context.user_data["login_password"] = password
    telegram_id = update.effective_user.id

    # Try to delete password message for security
    try:
        await update.message.delete()
    except Exception:
        pass

    status_msg = await update.effective_chat.send_message(
        "⏳ در حال دریافت کد امنیتی (کپچا)..."
    )

    client = SamadClient(telegram_id=telegram_id)
    try:
        captcha_data = await client.get_captcha()
        context.user_data["captcha_validation"] = captcha_data["validation"]
        context.user_data["captcha_nonce"] = captcha_data["nonce"]

        raw_b64 = captcha_data["image"].replace("data:image/png;base64,", "")
        img_bytes = base64.b64decode(raw_b64)

        await status_msg.delete()
        await update.effective_chat.send_photo(
            photo=io.BytesIO(img_bytes),
            caption="🔐 لطفاً <b>کد امنیتی ۵ رقمی</b> تصویر بالا را وارد کنید:\n(برای انصراف /cancel را بفرستید)",
            parse_mode="HTML",
        )
        return WAITING_CAPTCHA

    except Exception as e:
        await status_msg.delete()
        await update.effective_chat.send_message(
            f"❌ <b>خطا در دریافت کد امنیتی:</b>\n{str(e)}\n\nجهت تلاش مجدد دستور /login را ارسال کنید.",
            parse_mode="HTML",
            reply_markup=get_main_keyboard(),
        )
        return ConversationHandler.END
    finally:
        await client.close()


async def receive_captcha(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Receives captcha text and attempts login."""
    captcha_text = update.message.text.strip()
    username = context.user_data.get("login_username", "")
    password = context.user_data.get("login_password", "")
    validation = context.user_data.get("captcha_validation", "")
    nonce = context.user_data.get("captcha_nonce", "")
    telegram_id = update.effective_user.id

    status_msg = await update.effective_chat.send_message(
        "⏳ در حال اعتبارسنجی و ورود به سامانه صمد..."
    )

    client = SamadClient(telegram_id=telegram_id)
    try:
        await client.login(
            username=username,
            password=password,
            captcha_text=captcha_text,
            validation=validation,
            nonce=nonce,
        )

        # Fetch profile
        full_name = ""
        try:
            profile = await client.get_user_profile()
            first = profile.get("firstName", "")
            last = profile.get("lastName", "")
            full_name = profile.get("fullName") or f"{first} {last}".strip()
            if full_name:
                await database.update_user_profile(telegram_id, full_name)
        except Exception:
            pass

        # Fetch available selfs
        try:
            selfs = await client.get_available_selfs()
            if selfs:
                await database.update_selected_self(
                    telegram_id, selfs[0]["id"], selfs[0]["name"]
                )
        except Exception:
            pass

        context.user_data.clear()
        await status_msg.delete()
        welcome_text = (
            f"✅ <b>ورود موفقیت‌آمیز بود!</b>\n\n"
            f"👤 کاربر: <b>{full_name or username}</b>\n"
            "اکنون به کلیه امکانات ربات دسترسی دارید."
        )
        await update.effective_chat.send_message(
            welcome_text, parse_mode="HTML", reply_markup=get_main_keyboard()
        )
        return ConversationHandler.END

    except SamadAPIError as e:
        await status_msg.delete()
        await update.effective_chat.send_message(
            f"❌ <b>خطا در ورود:</b>\n{e.message}\n\nجهت تلاش مجدد دستور /login را ارسال کنید.",
            parse_mode="HTML",
            reply_markup=get_main_keyboard(),
        )
        return ConversationHandler.END
    except Exception as e:
        await status_msg.delete()
        await update.effective_chat.send_message(
            f"❌ <b>خطای پیش‌بینی نشده:</b>\n{str(e)}\n\nجهت تلاش مجدد دستور /login را ارسال کنید.",
            parse_mode="HTML",
            reply_markup=get_main_keyboard(),
        )
        return ConversationHandler.END
    finally:
        await client.close()


async def cancel_login(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Cancels the login flow."""
    context.user_data.clear()
    await update.message.reply_html(
        "عملیات ورود لغو شد.", reply_markup=get_main_keyboard()
    )
    return ConversationHandler.END


async def logout_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Logs out the user and clears tokens."""
    telegram_id = update.effective_user.id
    await database.delete_user(telegram_id)
    await update.message.reply_html(
        "🚪 با موفقیت از حساب کاربری خارج شدید.\nبرای استفاده مجدد دستور /login را ارسال کنید.",
        reply_markup=ReplyKeyboardRemove(),
    )


async def profile_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Displays user profile and account details."""
    client = await check_authenticated(update, context)
    if not client:
        return

    try:
        user_db = await database.get_user(update.effective_user.id)
        profile = await client.get_user_profile()
        nurture = await client.get_nurture_profile()

        full_name = profile.get("fullName", user_db.get("full_name", "نامشخص"))
        student_id = profile.get("username", user_db.get("username", "نامشخص"))
        credit = nurture.get("credit", 0)
        self_name = user_db.get("selected_self_name", "تعیین نشده")

        student_info = profile.get("student", {})
        major = student_info.get("studyMajor", {}).get("name", "نامشخص")
        level = student_info.get("studyLevel", {}).get("name", "نامشخص")

        msg = (
            "👤 <b>اطلاعات حساب کاربری</b>\n\n"
            f"▫️ <b>نام و نام خانوادگی:</b> {full_name}\n"
            f"▫️ <b>شماره دانشجویی:</b> <code>{student_id}</code>\n"
            f"▫️ <b>مقطع و رشته:</b> {level} - {major}\n"
            f"▫️ <b>سلف پیش‌فرض:</b> {self_name}\n"
            f"▫️ <b>موجودی اعتبار:</b> {format_toman(credit)}\n\n"
            "برای تغییر سلف پیش‌فرض از دکمه «⚙️ انتخاب سلف» استفاده کنید."
        )
        await update.message.reply_html(msg)
    except SamadAPIError as e:
        await update.message.reply_html(f"❌ {e.message}")
    finally:
        await client.close()


def get_login_conversation_handler() -> ConversationHandler:
    return ConversationHandler(
        entry_points=[
            CommandHandler("login", login_command),
            CallbackQueryHandler(login_command, pattern=r"^start_login$"),
        ],
        states={
            WAITING_USERNAME: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, receive_username)
            ],
            WAITING_PASSWORD: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, receive_password)
            ],
            WAITING_CAPTCHA: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, receive_captcha)
            ],
        },
        fallbacks=[CommandHandler("cancel", cancel_login)],
    )
