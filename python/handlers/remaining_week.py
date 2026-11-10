from datetime import datetime
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes
from samad_client import SamadClient, SamadAPIError
from handlers.common import check_authenticated
from date_helper import get_current_week_saturday_str, format_toman


async def remaining_week_food_command(
    update: Update, context: ContextTypes.DEFAULT_TYPE
):
    """Handles '📋 غذاهای رزرو مانده هفته' command."""
    client = await check_authenticated(update, context)
    if not client:
        return

    now = datetime.now()
    today_str = now.strftime("%Y-%m-%d")

    status_msg = await update.effective_chat.send_message(
        "⏳ در حال استعلام غذاهای رزرو شده هفته جاری..."
    )

    try:
        current_week_sat = get_current_week_saturday_str(now)
        data = await client.get_reservation_info(current_week_sat)

        remain_credit = data.get("remainCredit")
        week_days = data.get("weekDays", [])

        remaining_reserves = []

        for day in week_days:
            day_date = day.get("date", "")
            day_name = day.get("dayTranslated", "")
            date_jstr = day.get("dateJStr", "")
            time_dist = day.get("timeDistanceUntilToday", 0)

            # Filter today onwards or unconsumed
            is_upcoming = day_date >= today_str or time_dist >= 0

            for meal_type in day.get("mealTypes", []):
                meal_title = meal_type.get("name") or meal_type.get("mealTypeTitle", "ناهار")
                meal_type_id = meal_type.get("mealTypeId", 1)

                res_list = []
                if "reserve" in meal_type and isinstance(meal_type["reserve"], dict):
                    res_list.append(meal_type["reserve"])
                elif "reserves" in meal_type and isinstance(meal_type["reserves"], list):
                    res_list.extend(meal_type["reserves"])

                for res in res_list:
                    consumed = res.get("consumed", False)
                    time_dist = res.get("timeDistanceUntilToday", 0)
                    is_upcoming = day_date >= today_str or time_dist >= 0
                    # If upcoming or not consumed
                    if is_upcoming or not consumed:
                        remaining_reserves.append(
                            {
                                "day_name": day_name,
                                "date_jstr": date_jstr,
                                "meal_title": meal_title,
                                "meal_type_id": meal_type_id,
                                "reserve": res,
                            }
                        )

        await status_msg.delete()

        if not remaining_reserves:
            text = (
                "📋 <b>غذاهای رزرو مانده هفته جاری</b>\n\n"
                "ℹ️ شما در ادامه هفته جاری هیچ وعده غذایی رزرو شده‌ای ندارید.\n\n"
                "جهت رزرو غذاهای هفته بعد می‌توانید از گزینه «📅 لیست غذاهای هفته بعدی» استفاده کنید."
            )
            await update.effective_chat.send_message(text, parse_mode="HTML")
            return

        text = (
            "📋 <b>لیست غذاهای رزرو شده باقی‌مانده این هفته:</b>\n"
            f"💰 موجودی باقی‌مانده: {format_toman(remain_credit)}\n"
            "─────────────────\n"
        )

        buttons = []
        for item in remaining_reserves:
            day_name = item["day_name"]
            date_jstr = item["date_jstr"]
            meal_title = item["meal_title"]
            meal_type_id = item["meal_type_id"]
            res = item["reserve"]

            reserve_id = res.get("id")
            program_id = res.get("programId")
            food_type_id = res.get("foodTypeId", 101)
            food_name = res.get("foodNames") or res.get("foodName") or "نامشخص"
            self_name = res.get("selfName") or res.get("self") or "سلف"
            consumed = res.get("consumed", False)
            price = res.get("price", 0)

            status_str = "✅ دریافت شده" if consumed else "⏳ در انتظار تحویل"

            text += (
                f"\n🗓 <b>{day_name} ({date_jstr})</b> - <b>{meal_title}</b>\n"
                f"🍱 {food_name}\n"
                f"🏛 {self_name} | {format_toman(price)}\n"
                f"📌 {status_str}\n"
            )

            if not consumed and reserve_id:
                row = [
                    InlineKeyboardButton(
                        f"📱 کد {day_name} ({meal_title})",
                        callback_data=f"forget_code_{reserve_id}",
                    )
                ]
                if program_id:
                    row.append(
                        InlineKeyboardButton(
                            f"❌ لغو",
                            callback_data=f"cancel_meal_{program_id}_{food_type_id}_{meal_type_id}",
                        )
                    )
                buttons.append(row)

        reply_markup = InlineKeyboardMarkup(buttons) if buttons else None
        await update.effective_chat.send_message(
            text, parse_mode="HTML", reply_markup=reply_markup
        )

    except SamadAPIError as e:
        await status_msg.delete()
        await update.effective_chat.send_message(f"❌ {e.message}")
    except Exception as e:
        await status_msg.delete()
        await update.effective_chat.send_message(f"❌ خطا: {str(e)}")
    finally:
        await client.close()


async def cancel_meal_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles meal cancellation confirmation and execution."""
    query = update.callback_query
    await query.answer()

    data = query.data.replace("cancel_meal_", "").split("_")
    if len(data) != 3:
        await query.message.reply_html("اطلاعات درخواست لغو نامعتبر است.")
        return

    program_id = int(data[0])
    food_type_id = int(data[1])
    meal_type_id = int(data[2])

    client = await check_authenticated(update, context)
    if not client:
        return

    try:
        msg = await client.set_food_reservation(
            program_id=program_id,
            food_type_id=food_type_id,
            meal_type_id=meal_type_id,
            selected=False,
        )
        await query.message.reply_html(f"✅ {msg}")
    except SamadAPIError as e:
        await query.message.reply_html(f"❌ {e.message}")
    except Exception as e:
        await query.message.reply_html(f"❌ خطا در لغو غذا: {e}")
    finally:
        await client.close()
