from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes
from samad_client import SamadClient, SamadAPIError
from handlers.common import check_authenticated
from date_helper import format_toman
from config import SAMAD_BASE_URL, PAY_SHARIF_URL


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

        # Try to get login token for seamless payment redirect
        login_token = ""
        try:
            login_token = await client.get_login_token()
        except Exception:
            pass

        sep = "&" if "?" in PAY_SHARIF_URL else "?"
        charge_url = (
            f"{PAY_SHARIF_URL}{sep}token={login_token}&loginToken={login_token}&loginAsToken={login_token}"
            if login_token
            else PAY_SHARIF_URL
        )

        buttons = [
            [
                InlineKeyboardButton(
                    "💳 افزایش مستقیم اعتبار (view.rose)", url=charge_url
                )
            ],
            [
                InlineKeyboardButton(
                    "➕ سایر گزینه‌های شارژ", callback_data="recharge_credit"
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


async def increase_credit_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles '💳 افزایش اعتبار' command."""
    client = await check_authenticated(update, context)
    if not client:
        return

    status_msg = await update.effective_chat.send_message(
        "⏳ در حال ایجاد لینک ورود مستقیم به صفحه افزایش اعتبار صمد..."
    )

    try:
        login_token = await client.get_login_token()
        await status_msg.delete()

        # Build direct login URL with token
        base = SAMAD_BASE_URL.rstrip("/")
        if login_token:
            direct_url = f"{base}/#/token-login?token={login_token}"
            sep = "&" if "?" in PAY_SHARIF_URL else "?"
            charge_url = f"{PAY_SHARIF_URL}{sep}token={login_token}&loginToken={login_token}&loginAsToken={login_token}"
        else:
            direct_url = f"{base}"
            charge_url = PAY_SHARIF_URL

        text = (
            "💳 <b>افزایش آنلاین اعتبار تغذیه صمد</b>\n\n"
            "برای شارژ مستقیم کیف پول تغذیه دانشگاه صنعتی شریف، می‌توانید از طریق صفحه پرداخت صمد (view.rose) اقدام کنید.\n\n"
            "🔹 توکن اختصاصی شما در دکمه زیر قرار گرفته تا مستقیماً به صفحه پرداخت با هویت حساب خود متصل شوید.\n"
            "🔹 همچنین دکمه ورود سریع با توکن به سامانه صمد در دسترس است.\n"
            "🔹 پس از اتمام پرداخت، موجودی حساب شما به‌صورت آنی در ربات به‌روزرسانی خواهد شد."
        )

        buttons = [
            [InlineKeyboardButton("💳 ورود مستقیم به صفحه افزایش اعتبار (view.rose)", url=charge_url)],
            [InlineKeyboardButton("🔗 ورود سریع با توکن به سامانه صمد", url=direct_url)],
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
