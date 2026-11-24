import re
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes
import database
from samad_client import SamadClient
from date_helper import (
    get_tehran_today_info,
    get_current_week_saturday_str,
    get_next_week_saturday_str,
    normalize_weekly_programs,
    format_toman,
)
from handlers.common import check_authenticated, BTN_AUTORESERVE


def normalize_persian_text(text: str) -> str:
    """Normalizes Arabic/Persian characters and diacritics for accurate food keyword matching."""
    if not text:
        return ""
    text = (
        text.replace("ي", "ی")
        .replace("ك", "ک")
        .replace("ة", "ه")
        .replace("ۀ", "ه")
        .replace("\u200c", " ")
    )
    text = re.sub(r"[\u064B-\u065F]", "", text)
    text = re.sub(r"\s+", " ", text).strip().lower()
    return text


def match_favorite_food(food_name: str, favorites: List[str]) -> Optional[str]:
    """Checks if a food name matches any user favorite keyword."""
    norm_food = normalize_persian_text(food_name)
    for fav in favorites:
        norm_fav = normalize_persian_text(fav)
        if not norm_fav:
            continue
        if norm_fav in norm_food or norm_food in norm_fav:
            return fav
    return None


async def render_autoreserve_panel(telegram_id: int):
    user = await database.get_user(telegram_id)
    favorites = await database.get_favorite_foods(telegram_id)
    is_enabled = user.get("auto_reserve_enabled") == 1 if user else False

    status_text = "✅ <b>روشن و فعال</b>" if is_enabled else "🔕 <b>خاموش و غیرفعال</b>"
    self_name = user.get("selected_self_name") or "تعیین نشده" if user else "تعیین نشده"
    fav_count = len(favorites)

    text = (
        "🤖 <b>سامانه رزرو خودکار هوشمند غذا</b>\n\n"
        f"وضعیت فعلی: {status_text}\n"
        f"🏛 سلف پیش‌فرض: <b>{self_name}</b>\n"
        f"⭐️ غذاهای موردعلاقه ثبت‌شده: <b>{fav_count} غذا</b>\n"
        "📅 محدوده رزرو: <b>کلیه روزهای باز (مانده هفته و هفته آینده)</b>\n\n"
        "💡 <i>نحوه کارکرد:</i>\n"
        "موتور رزرو خودکار هر شب (به‌ویژه شب‌های دوشنبه، سه‌شنبه و چهارشنبه ساعت ۲۱:۳۰) منوی روزهای باز سلف شما را بررسی کرده "
        "و در صورت موجود بودن غذای محبوب و عدم رزرو قبلی، آن را به‌طور خودکار برای شما رزرو می‌نماید.\n\n"
        "همچنین هر زمان بخواهید می‌توانید با دکمه زیر، رزرو خودکار را در همان لحظه اجرا کنید:"
    )

    keyboard = [
        [
            InlineKeyboardButton(
                "🔕 غیرفعال کردن رزرو خودکار" if is_enabled else "🔔 فعال کردن رزرو خودکار",
                callback_data="py_toggle_autoreserve",
            )
        ],
        [
            InlineKeyboardButton(
                "⚡️ بررسی و رزرو خودکار همین حالا",
                callback_data="py_run_autoreserve_now",
            )
        ],
        [
            InlineKeyboardButton(
                "⭐️ مدیریت لیست غذاهای موردعلاقه",
                callback_data="py_fav_back",
            )
        ],
        [
            InlineKeyboardButton(
                "💰 استعلام موجودی کیف پول",
                callback_data="check_balance_now",
            )
        ],
    ]
    return text, InlineKeyboardMarkup(keyboard)


async def autoreserve_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles /autoreserve command and BTN_AUTORESERVE."""
    client = await check_authenticated(update, context)
    if not client:
        return

    telegram_id = update.effective_user.id
    text, reply_markup = await render_autoreserve_panel(telegram_id)
    if update.callback_query:
        await update.callback_query.answer()
        await update.callback_query.edit_message_text(text, parse_mode="HTML", reply_markup=reply_markup)
    else:
        await update.message.reply_html(text, reply_markup=reply_markup)


async def toggle_autoreserve_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Toggles auto-reservation state."""
    query = update.callback_query
    telegram_id = update.effective_user.id
    user = await database.get_user(telegram_id)
    if not user:
        await query.answer("ابتدا وارد شوید.", show_alert=True)
        return

    new_state = user.get("auto_reserve_enabled") != 1
    await database.set_auto_reserve_settings(telegram_id, new_state)
    await query.answer(
        "✅ رزرو خودکار هوشمند فعال شد." if new_state else "🔕 رزرو خودکار هوشمند غیرفعال شد."
    )

    text, reply_markup = await render_autoreserve_panel(telegram_id)
    await query.edit_message_text(text, parse_mode="HTML", reply_markup=reply_markup)


async def execute_auto_reserve_for_user(telegram_id: int, bot) -> Dict[str, Any]:
    """Executes the auto-reservation engine for a single user."""
    user = await database.get_user(telegram_id)
    if not user or not user.get("access_token"):
        return {"reserved": [], "low_credit": [], "errors": ["کاربر یافت نشد یا لاگین نیست"]}

    favorites = await database.get_favorite_foods(telegram_id)
    if not favorites:
        return {"reserved": [], "low_credit": [], "errors": ["لیست علاقه‌مندی‌ها خالی است"]}

    client = await SamadClient.for_user(telegram_id)
    if not client:
        return {"reserved": [], "low_credit": [], "errors": ["خطا در ایجاد نشست کاربری"]}

    reserved_meals = []
    low_credit_alerts = []
    errors = []

    # Get wallet credit
    current_credit = 0
    try:
        nurture = await client.get_nurture_profile()
        current_credit = nurture.get("currentCredit") or nurture.get("credit") or 0
    except Exception:
        pass

    self_id = user.get("selected_self_id") or 1
    self_name = user.get("selected_self_name") or "سلف"
    today = get_tehran_today_info()
    today_iso = today["iso_date"]

    candidate_programs = []
    # 1. Remaining days of current week
    try:
        cur_sat = get_current_week_saturday_str()
        cur_data = await client.get_reservable_programs(self_id, cur_sat)
        cur_days = normalize_weekly_programs(cur_data)
        candidate_programs.extend([d for d in cur_days if (d.get("date") or "") >= today_iso])
    except Exception:
        pass

    # 2. Next week days
    try:
        next_sat = get_next_week_saturday_str()
        next_data = await client.get_reservable_programs(self_id, next_sat)
        next_days = normalize_weekly_programs(next_data)
        candidate_programs.extend(next_days)
    except Exception:
        pass

    for day in candidate_programs:
        for meal in day.get("meals", []):
            foods = meal.get("foods", [])
            if any(f.get("is_reserved") for f in foods):
                continue

            matched_foods = [
                f for f in foods
                if not f.get("reserve_rule_violated") and match_favorite_food(f.get("food_name", ""), favorites)
            ]
            if not matched_foods:
                continue

            selected = matched_foods[0]
            price = selected.get("price", 0)

            if current_credit < price:
                low_credit_alerts.append({
                    "food_name": selected.get("food_name"),
                    "required_toman": price // 10,
                    "balance_toman": current_credit // 10,
                    "meal_title": meal.get("meal_type_title"),
                    "day_title": f"{day.get('day_translated')} ({day.get('date_jstr')})",
                })
                continue

            try:
                await client.set_food_reservation(
                    selected.get("program_id"),
                    selected.get("food_type_id"),
                    selected.get("meal_type_id"),
                    True,
                )
                current_credit -= price
                selected["is_reserved"] = True
                reserved_meals.append({
                    "food_name": selected.get("food_name"),
                    "day_translated": day.get("day_translated"),
                    "date_jstr": day.get("date_jstr"),
                    "meal_title": meal.get("meal_type_title"),
                    "self_name": self_name,
                    "price": price,
                })
            except Exception as e:
                errors.append(f"خطا در رزرو {selected.get('food_name')}: {e}")

    # Dispatch notifications
    if reserved_meals:
        msg = (
            "🤖 <b>رزرو خودکار هوشمند غذا با موفقیت انجام شد!</b>\n\n"
            "غذاهای زیر بر اساس لیست ⭐️ <b>علاقه‌مندی‌های شما</b> برای روزهای پیش‌رو رزرو شدند:\n\n"
        )
        for r in reserved_meals:
            msg += (
                f"🗓 <b>{r['day_translated']} ({r['date_jstr']}) - {r['meal_title']}</b>\n"
                f"🍱 <b>{r['food_name']}</b>\n"
                f"🏛 {r['self_name']} | 💰 {format_toman(r['price'])}\n"
                "─────────────────\n"
            )
        msg += (
            f"💳 مانده اعتبار کیف پول شما: <b>{format_toman(current_credit)}</b>\n\n"
            "⚙️ <i>مدیریت علاقه‌مندی‌ها و تنظیمات رزرو خودکار: /autoreserve</i>"
        )
        try:
            await bot.send_message(telegram_id, msg, parse_mode="HTML")
        except Exception:
            pass

    if low_credit_alerts:
        alert_msg = (
            "⚠️ <b>هشدار کسری موجودی برای رزرو خودکار صمد</b>\n\n"
            "غذاهای موردعلاقه شما در منوی سلف موجود است، اما موجودی حساب شما برای رزرو کافی نیست:\n\n"
        )
        for a in low_credit_alerts:
            alert_msg += (
                f"🍱 <b>{a['food_name']}</b> ({a['meal_title']})\n"
                f"🗓 <b>{a['day_title']}</b>\n"
                f"💵 هزینه غذا: <b>{a['required_toman']:,} تومان</b>\n"
                f"💰 موجودی فعلی: <b>{a['balance_toman']:,} تومان</b>\n"
                "─────────────────\n"
            )
        alert_msg += "👇 جهت شارژ آنلاین کیف پول صمد و ثبت رزروها، دستور /charge را ارسال کنید."
        try:
            await bot.send_message(telegram_id, alert_msg, parse_mode="HTML")
        except Exception:
            pass

    return {
        "reserved": reserved_meals,
        "low_credit": low_credit_alerts,
        "errors": errors,
    }


async def run_autoreserve_now_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Executes auto-reserve on-demand from inline button."""
    query = update.callback_query
    await query.answer("در حال بررسی منو و رزرو خودکار...")

    telegram_id = update.effective_user.id
    wait_msg = await query.message.reply_html("⏳ در حال استعلام منوی سلف و تطبیق با لیست غذاهای موردعلاقه شما...")

    result = await execute_auto_reserve_for_user(telegram_id, context.bot)
    try:
        await wait_msg.delete()
    except Exception:
        pass

    reserved_count = len(result["reserved"])
    low_credit_count = len(result["low_credit"])

    if reserved_count == 0 and low_credit_count == 0:
        favs = await database.get_favorite_foods(telegram_id)
        if not favs:
            await query.message.reply_html(
                "ℹ️ <b>لیست علاقه‌مندی‌های شما خالی است!</b>\n\n"
                "جهت استفاده از رزرو خودکار، ابتدا باید حداقل یک غذای محبوب اضافه کنید.",
                reply_markup=InlineKeyboardMarkup(
                    [[InlineKeyboardButton("⭐️ افزودن غذای موردعلاقه", callback_data="py_fav_add_manual")]]
                ),
            )
        else:
            await query.message.reply_html(
                "ℹ️ <b>بررسی منو انجام شد</b>\n\n"
                "در حال حاضر تمامی روزهای باز قبلاً رزرو شده‌اند یا غذای جدیدی مطابق با لیست علاقه‌مندی‌های شما یافت نشد."
            )


async def send_nightly_autoreserve_job(context: ContextTypes.DEFAULT_TYPE):
    """Job queue callback: executes nightly auto-reservation for all enabled users."""
    users = await database.get_auto_reserve_users()
    for u in users:
        try:
            await execute_auto_reserve_for_user(u["telegram_id"], context.bot)
        except Exception:
            pass
