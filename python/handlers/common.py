import io
import qrcode
from typing import Optional, Callable
from telegram import ReplyKeyboardMarkup, KeyboardButton, Update
from telegram.ext import ContextTypes
import database
from samad_client import SamadClient

# Main Menu Keyboard Buttons
BTN_TODAY = "🍽 دریافت غذای روز"
BTN_REMAINING = "📋 غذاهای رزرو مانده هفته"
BTN_NEXT_WEEK = "📅 لیست غذاهای هفته بعدی"
BTN_BUY = "🛒 خرید و رزرو غذا"
BTN_CREDIT = "💰 مانده اعتبار"
BTN_CHARGE = "💳 افزایش اعتبار"
BTN_SELF = "⚙️ انتخاب سلف"
BTN_PROFILE = "👤 حساب کاربری"


def get_main_keyboard() -> ReplyKeyboardMarkup:
    """Returns the main persistent reply keyboard."""
    keyboard = [
        [KeyboardButton(BTN_TODAY), KeyboardButton(BTN_REMAINING)],
        [KeyboardButton(BTN_NEXT_WEEK), KeyboardButton(BTN_BUY)],
        [KeyboardButton(BTN_CREDIT), KeyboardButton(BTN_CHARGE)],
        [KeyboardButton(BTN_SELF), KeyboardButton(BTN_PROFILE)],
    ]
    return ReplyKeyboardMarkup(keyboard, resize_keyboard=True)


def generate_qr_code(text: str) -> io.BytesIO:
    """Generates a QR Code in memory as BytesIO for forget-card-codes."""
    qr = qrcode.QRCode(
        version=1,
        box_size=10,
        border=3,
    )
    qr.add_data(text)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    bio = io.BytesIO()
    img.save(bio, format="PNG")
    bio.seek(0)
    return bio


async def check_authenticated(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> Optional[SamadClient]:
    """
    Checks if user is authenticated.
    If authenticated, returns an initialized SamadClient.
    If not, sends a message asking user to login and returns None.
    """
    telegram_id = update.effective_user.id
    client = await SamadClient.for_user(telegram_id)
    if not client:
        msg = (
            "⚠️ <b>شما هنوز وارد حساب سامانه صمد نشده‌اید.</b>\n\n"
            "لطفاً با ارسال دستور /login یا فشردن دکمه ورود، شماره دانشجویی و رمز عبور خود را وارد کنید."
        )
        if update.callback_query:
            await update.callback_query.answer()
            await update.callback_query.message.reply_html(msg)
        elif update.message:
            await update.message.reply_html(msg)
        return None
    return client
