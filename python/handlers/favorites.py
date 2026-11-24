import urllib.parse
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes, ConversationHandler, CommandHandler, MessageHandler, CallbackQueryHandler, filters
import database
from handlers.common import check_authenticated, BTN_FAVORITES

POPULAR_FOOD_SUGGESTIONS = [
    "چلو کباب کوبیده",
    "چلو جوجه کباب",
    "زرشک پلو با مرغ",
    "چلو خورش قورمه سبزی",
    "چلو خورش قیمه",
    "شنسل مرغ",
    "پیتزا",
    "چلو گوشت",
    "ماکارونی",
]

WAITING_FAVORITE_INPUT = 1


async def render_favorites_panel(telegram_id: int):
    favs = await database.get_favorite_foods(telegram_id)
    text = (
        "⭐️ <b>لیست غذاهای موردعلاقه من</b>\n\n"
        "این لیست برای <b>رزرو خودکار هوشمند غذا</b> استفاده می‌شود. "
        "هر زمان این غذاها در منوی سلف شما باز شوند، ربات به‌صورت خودکار آن‌ها را برای روزهای باقی‌مانده هفته و روزهای پیش‌رو رزرو خواهد کرد.\n\n"
    )

    keyboard = []
    if not favs:
        text += (
            "<i>شما هنوز هیچ غذای موردعلاقه‌ای اضافه نکرده‌اید!</i>\n\n"
            "برای شروع، می‌توانید نام غذای محبوب خود (مثلاً کباب، جوجه، پیتزا) را تایپ کنید یا از دکمه‌های پیشنهادی زیر استفاده نمایید:\n"
        )
    else:
        text += f"📋 <b>غذاهای ثبت‌شده در علاقه‌مندی‌ها ({len(favs)} مورد):</b>\n"
        for idx, food in enumerate(favs, 1):
            text += f"▫️ {idx}. <b>{food}</b>\n"
            keyboard.append(
                [InlineKeyboardButton(f"❌ حذف {food}", callback_data=f"py_fav_del_{urllib.parse.quote(food)}")]
            )
        text += "\n─────────────────\n"

    keyboard.append([InlineKeyboardButton("➕ نوشتن نام غذای دلخواه", callback_data="py_fav_add_manual")])
    keyboard.append([InlineKeyboardButton("💡 انتخاب از غذاهای محبوب دانشگاه", callback_data="py_fav_sug_show")])
    keyboard.append([InlineKeyboardButton("🤖 تنظیمات رزرو خودکار", callback_data="py_open_autoreserve")])

    return text, InlineKeyboardMarkup(keyboard)


async def favorites_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles /favorites command and BTN_FAVORITES."""
    client = await check_authenticated(update, context)
    if not client:
        return

    telegram_id = update.effective_user.id
    text, reply_markup = await render_favorites_panel(telegram_id)
    if update.callback_query:
        await update.callback_query.answer()
        await update.callback_query.edit_message_text(text, parse_mode="HTML", reply_markup=reply_markup)
    else:
        await update.message.reply_html(text, reply_markup=reply_markup)


async def fav_del_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles deleting a favorite food."""
    query = update.callback_query
    await query.answer()

    raw_food = urllib.parse.unquote(query.data.replace("py_fav_del_", ""))
    telegram_id = update.effective_user.id
    await database.remove_favorite_food(telegram_id, raw_food)

    text, reply_markup = await render_favorites_panel(telegram_id)
    await query.edit_message_text(text, parse_mode="HTML", reply_markup=reply_markup)


async def fav_show_suggestions_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Shows popular food suggestions."""
    query = update.callback_query
    await query.answer()

    telegram_id = update.effective_user.id
    current_list = await database.get_favorite_foods(telegram_id)

    text = (
        "💡 <b>پیشنهاد از غذاهای محبوب دانشگاهی</b>\n\n"
        "برای افزودن سریع هر یک از غذاها به لیست علاقه‌مندی‌های خود، روی آن کلیک کنید:\n"
    )

    keyboard = []
    for food in POPULAR_FOOD_SUGGESTIONS:
        if food in current_list:
            keyboard.append([InlineKeyboardButton(f"✅ {food} (موجود)", callback_data="py_noop")])
        else:
            keyboard.append(
                [InlineKeyboardButton(f"➕ {food}", callback_data=f"py_fav_sug_add_{urllib.parse.quote(food)}")]
            )

    keyboard.append([InlineKeyboardButton("🔙 بازگشت به لیست علاقه‌مندی‌ها", callback_data="py_fav_back")])
    await query.edit_message_text(text, parse_mode="HTML", reply_markup=InlineKeyboardMarkup(keyboard))


async def fav_add_suggested_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Adds a suggested food item."""
    query = update.callback_query
    raw_food = urllib.parse.unquote(query.data.replace("py_fav_sug_add_", ""))
    telegram_id = update.effective_user.id

    await database.add_favorite_food(telegram_id, raw_food)
    await query.answer(f"✅ «{raw_food}» به علاقه‌مندی‌ها اضافه شد!")

    text, reply_markup = await render_favorites_panel(telegram_id)
    await query.edit_message_text(text, parse_mode="HTML", reply_markup=reply_markup)


async def fav_add_manual_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Prompts user to enter favorite food name."""
    query = update.callback_query
    await query.answer()

    text = (
        "✍️ <b>افزودن غذای موردعلاقه</b>\n\n"
        "لطفاً نام یا کلمه کلیدی غذای موردنظر خود را ارسال کنید:\n"
        "<i>(مثال: جوجه کباب، قورمه سبزی، پیتزا، زرشک پلو)</i>\n\n"
        "ℹ️ برای انصراف دستور /cancel را ارسال کنید."
    )
    keyboard = [[InlineKeyboardButton("🔙 بازگشت و انصراف", callback_data="py_fav_back")]]
    await query.message.reply_html(text, reply_markup=InlineKeyboardMarkup(keyboard))
    return WAITING_FAVORITE_INPUT


async def fav_text_input_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles text input for favorite food."""
    food_name = update.message.text.strip()
    telegram_id = update.effective_user.id

    await database.add_favorite_food(telegram_id, food_name)

    keyboard = [
        [InlineKeyboardButton("➕ افزودن غذای دیگر", callback_data="py_fav_add_manual")],
        [InlineKeyboardButton("⭐️ مشاهده لیست غذاهای موردعلاقه", callback_data="py_fav_back")],
        [InlineKeyboardButton("🤖 تنظیمات رزرو خودکار", callback_data="py_open_autoreserve")],
    ]
    await update.message.reply_html(
        f"✅ غذای «<b>{food_name}</b>» با موفقیت به لیست علاقه‌مندی‌های شما اضافه شد!",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )
    return ConversationHandler.END


async def fav_cancel_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Cancels favorite input."""
    await update.message.reply_text("عملیات افزودن غذا لغو شد.")
    return ConversationHandler.END


def get_favorite_conversation_handler():
    return ConversationHandler(
        entry_points=[
            CallbackQueryHandler(fav_add_manual_callback, pattern=r"^py_fav_add_manual$")
        ],
        states={
            WAITING_FAVORITE_INPUT: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, fav_text_input_handler)
            ]
        },
        fallbacks=[
            CommandHandler("cancel", fav_cancel_handler),
            CallbackQueryHandler(favorites_command, pattern=r"^py_fav_back$"),
        ],
        per_chat=True,
    )
