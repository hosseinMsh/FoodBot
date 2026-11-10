from datetime import datetime
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes
from samad_client import SamadClient, SamadAPIError
from handlers.common import check_authenticated, generate_qr_code
from date_helper import (
    get_current_week_saturday_str,
    to_jalali_str,
    get_persian_weekday_name,
    format_toman,
)


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
