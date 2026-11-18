import logging
from datetime import datetime, timezone, timedelta
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes
import database
from samad_client import SamadClient, SamadAPIError
from handlers.common import check_authenticated, generate_qr_code
from date_helper import (
    get_current_week_saturday_str,
    to_jalali_str,
    get_persian_weekday_name,
    format_toman,
)

logger = logging.getLogger("FoodBot.DailyAutoCode")
TEHRAN_TZ = timezone(timedelta(hours=3, minutes=30))


async def today_food_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles '🍽 دریافت غذای روز' command."""
    client = await check_authenticated(update, context)
    if not client:
        return

    now = datetime.now()
    today_str = now.strftime("%Y-%m-%d")
    today_jalali = to_jalali_str(now)
    today_day_name = get_persian_weekday_name(now)

    status_msg = await update.effective_chat.send_message("⏳ در حال دریافت اطلاعات غذای امروز...")

    try:
        current_week_sat = get_current_week_saturday_str(now)
        data = await client.get_reservation_info(current_week_sat)

        week_days = data.get("weekDays", [])
        today_meals = []

        for day in week_days:
            # Check if this is today
            day_date = day.get("date", "")
            if day_date == today_str:
                for meal_type in day.get("mealTypes", []):
                    meal_title = meal_type.get("name") or meal_type.get("mealTypeTitle", "ناهار")
                    res_list = []
                    if "reserve" in meal_type and isinstance(meal_type["reserve"], dict):
                        res_list.append(meal_type["reserve"])
                    elif "reserves" in meal_type and isinstance(meal_type["reserves"], list):
                        res_list.extend(meal_type["reserves"])

                    for reserve in res_list:
                        today_meals.append((meal_title, reserve))

        await status_msg.delete()

        if not today_meals:
            # No reserved meal for today
            reply_text = (
                f"📅 <b>{today_day_name} ({today_jalali})</b>\n\n"
                "❌ <b>شما برای امروز هیچ غذایی رزرو نکرده‌اید.</b>\n\n"
                "می‌توانید برای مشاهده غذاهای مازاد، از بخش «خرید از فروش روزانه» استفاده کنید."
            )
            keyboard = [
                [
                    InlineKeyboardButton(
                        "⚡️ بررسی و خرید فروش روزانه",
                        callback_data="daily_sales_list",
                    )
                ]
            ]
            await update.effective_chat.send_message(
                reply_text,
                parse_mode="HTML",
                reply_markup=InlineKeyboardMarkup(keyboard),
            )
            return

        # Build message for reserved meals
        text = f"🍽 <b>غذاهای رزرو شده برای امروز:</b>\n"
        text += f"📅 <b>{today_day_name} - {today_jalali}</b>\n\n"

        buttons = []
        for meal_title, res in today_meals:
            reserve_id = res.get("id")
            food_name = res.get("foodNames") or res.get("foodName") or "نامشخص"
            self_name = res.get("selfName") or res.get("self") or "سلف مرکزی"
            consumed = res.get("consumed", False)
            price = res.get("price", 0)

            status_icon = "✅ تحویل گرفته شده" if consumed else "⏳ در انتظار تحویل"

            text += (
                f"▪️ <b>وعده:</b> {meal_title}\n"
                f"🍱 <b>غذا:</b> {food_name}\n"
                f"🏛 <b>سلف:</b> {self_name}\n"
                f"💰 <b>هزینه:</b> {format_toman(price)}\n"
                f"📌 <b>وضعیت:</b> {status_icon}\n"
                f"🔢 <b>شماره ژتون/فیش:</b> <code>{reserve_id}</code>\n"
                "─────────────────\n"
            )

            if not consumed and reserve_id:
                buttons.append(
                    [
                        InlineKeyboardButton(
                            f"📱 دریافت کد تحویل / بارکد ({meal_title})",
                            callback_data=f"forget_code_{reserve_id}",
                        )
                    ]
                )

        reply_markup = InlineKeyboardMarkup(buttons) if buttons else None
        await update.effective_chat.send_message(
            text, parse_mode="HTML", reply_markup=reply_markup
        )

    except SamadAPIError as e:
        await status_msg.delete()
        await update.effective_chat.send_message(f"❌ {e.message}")
    except Exception as e:
        await status_msg.delete()
        await update.effective_chat.send_message(f"❌ خطا در پردازش: {str(e)}")
    finally:
        await client.close()


async def forget_code_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles 'forget_code_{reserve_id}' callback button."""
    query = update.callback_query
    await query.answer("در حال دریافت کد تحویل...")

    data = query.data
    reserve_id_str = data.replace("forget_code_", "")
    try:
        reserve_id = int(reserve_id_str)
    except ValueError:
        await query.message.reply_html("شناسه فیش نامعتبر است.")
        return

    client = await check_authenticated(update, context)
    if not client:
        return

    try:
        code_data = await client.get_forget_code(reserve_id)
        forgot_code = code_data.get("forgotCardCode", "")
        food_name = code_data.get("foodName", "غذا")
        self_name = code_data.get("self", "سلف")
        meal = code_data.get("meal", "وعده")

        if not forgot_code:
            await query.message.reply_html("❌ کد تحویل برای این غذا یافت نشد.")
            return

        # Generate QR code
        qr_bio = generate_qr_code(forgot_code)

        caption = (
            f"🎫 <b>کد تحویل / فراموشی کارت صمد</b>\n\n"
            f"🔢 <b>کد عددی:</b> <code>{forgot_code}</code>\n"
            f"🍽 <b>غذا:</b> {food_name}\n"
            f"🥣 <b>وعده:</b> {meal}\n"
            f"🏛 <b>سلف:</b> {self_name}\n\n"
            "📲 <i>این بارکد (QR Code) یا کد عددی را می‌توانید مستقیماً جلوی اسکنر سلف قرار دهید.</i>"
        )

        await query.message.reply_photo(
            photo=qr_bio, caption=caption, parse_mode="HTML"
        )
    except SamadAPIError as e:
        await query.message.reply_html(f"❌ {e.message}")
    except Exception as e:
        await query.message.reply_html(f"❌ خطا: {str(e)}")
    finally:
        await client.close()


def _render_autocode_panel(enabled: bool):
    status_text = (
        "✅ <b>فعال</b>\n"
        "هر روز <b>شنبه تا چهارشنبه ساعت ۱۱:۰۰ صبح</b>، در صورت داشتن غذای رزرو شده برای همان روز، "
        "کد تحویل و بارکد (QR Code) به صورت خودکار برایتان ارسال می‌شود."
        if enabled
        else "🔕 <b>غیرفعال</b>\nارسال خودکار روزانه برای شما متوقف شده است."
    )
    text = f"⏰ <b>ارسال خودکار کد تحویل و بارکد</b>\n\nوضعیت فعلی: {status_text}"
    kb = InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton(
                    "🔕 غیرفعال کردن" if enabled else "🔔 فعال کردن",
                    callback_data="toggle_autocode",
                )
            ]
        ]
    )
    return text, kb


async def autocode_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles /autocode command to manage 11:00 AM daily QR delivery."""
    client = await check_authenticated(update, context)
    if not client:
        return
    await client.close()

    user = await database.get_user(update.effective_user.id)
    enabled = (user.get("auto_send_code") if user else 1) != 0
    text, kb = _render_autocode_panel(enabled)
    await update.effective_chat.send_message(text, parse_mode="HTML", reply_markup=kb)


async def toggle_autocode_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Toggles automatic 11:00 AM delivery code sending."""
    query = update.callback_query
    telegram_id = update.effective_user.id
    user = await database.get_user(telegram_id)
    if not user:
        await query.answer("ابتدا وارد حساب کاربری شوید.")
        return

    new_state = user.get("auto_send_code") == 0
    await database.set_auto_send_code(telegram_id, new_state)
    await query.answer(
        "✅ ارسال خودکار ساعت ۱۱ فعال شد." if new_state else "🔕 ارسال خودکار ساعت ۱۱ غیرفعال شد."
    )
    text, kb = _render_autocode_panel(new_state)
    try:
        await query.edit_message_text(text, parse_mode="HTML", reply_markup=kb)
    except Exception:
        await update.effective_chat.send_message(text, parse_mode="HTML", reply_markup=kb)


async def send_daily_meal_codes_job(context: ContextTypes.DEFAULT_TYPE):
    """
    Scheduled job (11:00 AM Asia/Tehran, Saturday to Wednesday):
    Automatically sends delivery code & QR code for today's reserved meals.
    """
    now_tehran = datetime.now(TEHRAN_TZ).replace(tzinfo=None)
    # Python weekday(): Mon=0, Tue=1, Wed=2, Thu=3, Fri=4, Sat=5, Sun=6
    if now_tehran.weekday() in (3, 4):  # Skip Thursday & Friday
        return

    today_str = now_tehran.strftime("%Y-%m-%d")
    today_jalali = to_jalali_str(now_tehran)
    today_day_name = get_persian_weekday_name(now_tehran)
    current_week_sat = get_current_week_saturday_str(now_tehran)

    users = await database.get_auto_send_users()
    logger.info(f"Running daily 11:00 AM auto-code dispatch for {len(users)} users ({today_str}).")

    for user in users:
        telegram_id = user["telegram_id"]
        client = SamadClient(
            telegram_id=telegram_id,
            access_token=user["access_token"],
            refresh_token=user["refresh_token"],
            token_expires_at=user.get("token_expires_at"),
        )
        try:
            data = await client.get_reservation_info(current_week_sat)
            week_days = data.get("weekDays", []) if isinstance(data, dict) else []

            today_meals = []
            for day in week_days:
                if day.get("date", "").split(" ")[0] == today_str:
                    day_name = day.get("dayTranslated") or today_day_name
                    for meal_type in day.get("mealTypes", []):
                        meal_title = meal_type.get("name") or meal_type.get("mealTypeTitle", "ناهار")
                        res_list = []
                        if isinstance(meal_type.get("reserve"), dict):
                            res_list.append(meal_type["reserve"])
                        if isinstance(meal_type.get("reserves"), list):
                            res_list.extend(meal_type["reserves"])
                        for res in res_list:
                            if (
                                res.get("id")
                                and not res.get("consumed", False)
                                and not res.get("sold", False)
                                and res.get("selected", True) is not False
                            ):
                                today_meals.append((meal_title, day_name, res))

            for meal_title, day_name, res in today_meals:
                reserve_id = res["id"]
                try:
                    code_data = await client.get_forget_code(
                        reserve_id, daily_sale=bool(res.get("dailySell", False))
                    )
                    forgot_code = code_data.get("forgotCardCode", "")
                    if not forgot_code:
                        continue

                    food_name = (
                        code_data.get("foodName") or res.get("foodNames") or res.get("foodName") or "غذا"
                    ).rstrip("|")
                    self_name = code_data.get("self") or res.get("selfName") or res.get("self") or "سلف"
                    meal = code_data.get("meal") or meal_title

                    qr_bio = generate_qr_code(str(forgot_code))
                    caption = (
                        f"☀️ <b>یادآوری غذای امروز و کد تحویل خودکار</b>\n"
                        f"📅 <b>{day_name} - {today_jalali}</b>\n\n"
                        f"🔢 <b>کد تحویل:</b> <code>{forgot_code}</code>\n"
                        f"🍽 <b>غذا:</b> {food_name}\n"
                        f"🥣 <b>وعده:</b> {meal}\n"
                        f"🏛 <b>سلف:</b> {self_name}\n\n"
                        "📲 <i>این بارکد (QR Code) یا کد عددی را می‌توانید مستقیماً جلوی اسکنر سلف قرار دهید.</i>\n"
                        "⚙️ <i>مدیریت ارسال خودکار ساعت ۱۱: /autocode</i>"
                    )

                    await context.bot.send_photo(
                        chat_id=telegram_id,
                        photo=qr_bio,
                        caption=caption,
                        parse_mode="HTML",
                    )
                except Exception as meal_err:
                    logger.warning(
                        f"Failed to send auto-code for user {telegram_id}, reserve {reserve_id}: {meal_err}"
                    )
        except Exception as user_err:
            logger.warning(f"Failed daily reservation check for user {telegram_id}: {user_err}")
        finally:
            await client.close()
