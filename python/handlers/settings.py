from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes
import database
from samad_client import SamadClient, SamadAPIError
from handlers.common import check_authenticated


async def select_self_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles '⚙️ انتخاب سلف' to change user's preferred dining location."""
    if update.callback_query:
        await update.callback_query.answer()

    client = await check_authenticated(update, context)
    if not client:
        return

    status_msg = await update.effective_chat.send_message(
        "⏳ در حال بارگذاری لیست سلف‌های در دسترس شما..."
    )

    try:
        selfs = await client.get_available_selfs()
        await status_msg.delete()

        if not selfs:
            await update.effective_chat.send_message(
                "❌ هیچ سالن غذاخوری فعالی برای حساب شما یافت نشد."
            )
            return

        telegram_id = update.effective_user.id
        user_db = await database.get_user(telegram_id)
        current_self_id = user_db.get("selected_self_id") if user_db else None

        buttons = []
        for s in selfs:
            sid = s.get("id")
            sname = s.get("name", "سلف")
            is_active = (sid == current_self_id)
            label = f"✅ {sname}" if is_active else sname
            buttons.append(
                [InlineKeyboardButton(label, callback_data=f"set_self_{sid}")]
            )

        text = (
            "🏛 <b>انتخاب سالن غذاخوری (سلف)</b>\n\n"
            "لطفاً سلف پیش‌فرض خود را برای مشاهده برنامه‌ها و رزرو غذا انتخاب کنید:"
        )

        await update.effective_chat.send_message(
            text, parse_mode="HTML", reply_markup=InlineKeyboardMarkup(buttons)
        )

    except SamadAPIError as e:
        await status_msg.delete()
        await update.effective_chat.send_message(f"❌ {e.message}")
    except Exception as e:
        await status_msg.delete()
        await update.effective_chat.send_message(f"❌ خطا: {str(e)}")
    finally:
        await client.close()


async def set_self_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Callback for selecting a specific self."""
    query = update.callback_query
    await query.answer()

    data_str = query.data.replace("set_self_", "")
    try:
        self_id = int(data_str)
    except ValueError:
        return

    client = await check_authenticated(update, context)
    self_name = "سلف"
    if client:
        try:
            selfs = await client.get_available_selfs()
            for s in selfs:
                if s.get("id") == self_id:
                    self_name = s.get("name", "سلف")
                    break
        except Exception:
            pass
        finally:
            await client.close()

    telegram_id = update.effective_user.id
    await database.update_selected_self(telegram_id, self_id, self_name)

    await query.edit_message_text(
        f"✅ سلف پیش‌فرض شما با موفقیت به <b>{self_name}</b> تغییر یافت.",
        parse_mode="HTML",
    )
