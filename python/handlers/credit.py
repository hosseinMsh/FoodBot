from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes
from samad_client import SamadClient, SamadAPIError
from handlers.common import check_authenticated
from date_helper import format_toman
from config import SAMAD_BASE_URL


async def credit_balance_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles '💰 مانده اعتبار' command."""
    client = await check_authenticated(update, context)
    if not client:
        return

    status_msg = await update.effective_chat.send_message(
        "⏳ در حال استعلام موجودی و تراکنش‌ها..."
    )

    try:
        profile = await client.get_nurture_profile()
        credit = profile.get("credit", 0)
        user_info = profile.get("user", {})
        first = user_info.get("firstName", "")
        last = user_info.get("lastName", "")
        full_name = f"{first} {last}".strip() or user_info.get("fullName", "")
        student_id = user_info.get("username", "")

        credit_changes = profile.get("creditChanges", [])

        await status_msg.delete()

        text = (
            "💰 <b>وضعیت اعتبار و کیف پول</b>\n\n"
            f"👤 <b>دانشجو:</b> {full_name} ({student_id})\n"
            f"💳 <b>موجودی فعلی:</b> {format_toman(credit)}\n"
            "─────────────────\n"
        )

        if credit_changes:
            text += "📜 <b>تراکنش‌ها و افزایش اعتبارهای اخیر:</b>\n"
            # Show last 5 changes
            for item in credit_changes[:5]:
                amount = item.get("amount", 0)
                receipt = item.get("receipt", {})
                desc = receipt.get("paymentSystemName") or item.get("description", "شارژ حساب")
                action_date = item.get("createDate") or item.get("actionDate", "")
                sign = "+" if amount > 0 else ""
                text += f"▫️ {sign}{format_toman(amount)} | {action_date}\n   ({desc})\n"
        else:
            text += "<i>هیچ تراکنش اخیری ثبت نشده است.</i>\n"

        buttons = [
            [
                InlineKeyboardButton(
                    "💳 افزایش آنلاین اعتبار", callback_data="recharge_credit"
                )
            ]
        ]

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


async def increase_credit_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles '💳 افزایش اعتبار' command."""
    client = await check_authenticated(update, context)
    if not client:
        return

    status_msg = await update.effective_chat.send_message(
        "⏳ در حال ایجاد لینک ورود مستقیم به درگاه پرداخت سامانه صمد..."
    )

    try:
        login_token = await client.get_login_token()
        await status_msg.delete()

        # Build direct login URL with token
        base = SAMAD_BASE_URL.rstrip("/")
        if login_token:
            direct_url = f"{base}/#/token-login?token={login_token}"
        else:
            direct_url = f"{base}"

        text = (
            "💳 <b>افزایش آنلاین اعتبار تغذیه</b>\n\n"
            "برای شارژ حساب و اتصال به درگاه بانکی شتاب، می‌توانید از طریق دکمه زیر بدون نیاز به ورود مجدد رمز، مستقیماً به صفحه شارژ سامانه صمد منتقل شوید.\n\n"
            "🔹 پس از اتمام پرداخت، موجودی شما بلافاصله به‌روزرسانی شده و در ربات قابل مشاهده خواهد بود."
        )

        buttons = [
            [InlineKeyboardButton("🔗 ورود مستقیم به درگاه پرداخت صمد", url=direct_url)],
            [
                InlineKeyboardButton(
                    "🔄 بررسی مجدد موجودی", callback_data="check_balance_now"
                )
            ],
        ]

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


async def recharge_credit_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Callback query for recharge button."""
    query = update.callback_query
    await query.answer()
    await increase_credit_command(update, context)
