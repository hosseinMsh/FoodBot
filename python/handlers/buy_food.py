from datetime import datetime
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes
import database
from samad_client import SamadClient, SamadAPIError
from handlers.common import check_authenticated, generate_qr_code
from date_helper import get_next_week_saturday_str, format_toman, normalize_weekly_programs


async def buy_food_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles '🛒 خرید و رزرو غذا' command."""
    client = await check_authenticated(update, context)
    if not client:
        return

    text = (
        "🛒 <b>خرید و رزرو غذا</b>\n\n"
        "لطفاً یکی از روش‌های زیر را انتخاب کنید:\n\n"
        "1️⃣ <b>رزرو برنامه غذایی هفته آینده:</b>\n"
        "رزرو ناهار یا شام از منوی هفتگی سلف با نرخ مصوب دانشجویی.\n\n"
        "2️⃣ <b>خرید فوری از فروش روزانه:</b>\n"
        "خرید غذاهای مازاد آماده توزیع برای امروز بدون نیاز به رزرو قبلی."
    )

    buttons = [
        [
            InlineKeyboardButton(
                "📅 رزرو برنامه غذایی هفته آینده", callback_data="buy_weekly_start"
            )
        ],
        [
            InlineKeyboardButton(
                "⚡️ خرید فوری از فروش روزانه", callback_data="daily_sales_list"
            )
        ],
    ]

    await update.effective_chat.send_message(
        text, parse_mode="HTML", reply_markup=InlineKeyboardMarkup(buttons)
    )
    await client.close()


async def buy_weekly_start_callback(
    update: Update, context: ContextTypes.DEFAULT_TYPE
):
    """Shows days of next week for reserving food."""
    query = update.callback_query
    await query.answer()

    client = await check_authenticated(update, context)
    if not client:
        return

    telegram_id = update.effective_user.id
    user_db = await database.get_user(telegram_id)
    self_id = user_db.get("selected_self_id")
    self_name = user_db.get("selected_self_name", "سلف")

    if not self_id:
        try:
            selfs = await client.get_available_selfs()
            if selfs:
                self_id = selfs[0]["id"]
                self_name = selfs[0]["name"]
                await database.update_selected_self(telegram_id, self_id, self_name)
        except Exception:
            pass

    try:
        next_week_sat = get_next_week_saturday_str()
        prog_data = await client.get_reservable_programs(self_id, next_week_sat)
        days = normalize_weekly_programs(prog_data)

        if not days:
            await query.edit_message_text(
                f"❌ برنامه غذایی هفته آینده برای <b>{self_name}</b> هنوز تعریف نشده است.",
                parse_mode="HTML",
                reply_markup=InlineKeyboardMarkup(
                    [
                        [
                            InlineKeyboardButton(
                                "🔄 تغییر سلف", callback_data="change_self"
                            )
                        ]
                    ]
                ),
            )
            return

        # Store programs in context for navigation
        context.user_data["reserve_days"] = days
        context.user_data["reserve_self_id"] = self_id
        context.user_data["reserve_self_name"] = self_name

        text = (
            f"📅 <b>رزرو غذاهای هفته بعد</b>\n"
            f"🏛 <b>سلف:</b> {self_name}\n\n"
            "برای مشاهده وعده‌ها و ثبت رزرو، روی روز مورد نظر کلیک کنید:"
        )

        buttons = []
        for idx, d in enumerate(days):
            day_name = d.get("dayTranslated", "")
            date_jstr = d.get("dateJStr", "")
            buttons.append(
                [
                    InlineKeyboardButton(
                        f"🗓 {day_name} ({date_jstr})",
                        callback_data=f"buy_view_day_{idx}",
                    )
                ]
            )

        buttons.append(
            [InlineKeyboardButton("🏛 تغییر سلف", callback_data="change_self")]
        )

        await query.edit_message_text(
            text, parse_mode="HTML", reply_markup=InlineKeyboardMarkup(buttons)
        )

    except SamadAPIError as e:
        await query.message.reply_html(f"❌ {e.message}")
    except Exception as e:
        await query.message.reply_html(f"❌ خطا: {str(e)}")
    finally:
        await client.close()


async def buy_view_day_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Displays meals and food options for a specific day."""
    query = update.callback_query
    await query.answer()

    data = query.data
    day_idx = int(data.replace("buy_view_day_", ""))

    client = await check_authenticated(update, context)
    if not client:
        return

    telegram_id = update.effective_user.id
    user_db = await database.get_user(telegram_id)
    self_id = context.user_data.get("reserve_self_id") or user_db.get("selected_self_id")
    self_name = context.user_data.get("reserve_self_name") or user_db.get(
        "selected_self_name", "سلف"
    )

    try:
        # Refetch freshest program data to reflect reservations
        next_week_sat = get_next_week_saturday_str()
        prog_data = await client.get_reservable_programs(self_id, next_week_sat)
        days = normalize_weekly_programs(prog_data)
        context.user_data["reserve_days"] = days

        if day_idx >= len(days):
            await query.edit_message_text("روز انتخابی نامعتبر است.")
            return

        day = days[day_idx]
        day_name = day.get("dayTranslated", "")
        date_jstr = day.get("dateJStr", "")
        meals = day.get("meals", [])

        text = (
            f"🗓 <b>{day_name} ({date_jstr})</b>\n"
            f"🏛 <b>سلف:</b> {self_name}\n"
            "─────────────────\n"
        )

        buttons = []

        if not meals:
            text += "\n<i>در این روز غذایی سرو نمی‌شود.</i>\n"
        else:
            for meal in meals:
                meal_title = meal.get("mealTypeTitle", "ناهار")
                meal_type_id = meal.get("mealTypeId", 2)
                foods = meal.get("foods", [])

                text += f"\n▪️ <b>وعده {meal_title}:</b>\n"

                for f in foods:
                    prog_id = f.get("programId")
                    food_type_id = f.get("foodTypeId", 101)
                    food_name = f.get("foodName", "غذا")
                    price = f.get("price", 0)
                    is_reserved = f.get("isReserved", False)
                    rule_violated = f.get("reserveRuleViolated", False)

                    toman_str = f"{price // 10:,} تومان"

                    if is_reserved:
                        text += f"   ✅ <b>{food_name}</b> ({toman_str}) [رزرو شده]\n"
                        buttons.append(
                            [
                                InlineKeyboardButton(
                                    f"❌ لغو {food_name}",
                                    callback_data=f"do_cancel_{prog_id}_{food_type_id}_{meal_type_id}_{day_idx}",
                                )
                            ]
                        )
                    elif rule_violated:
                        text += f"   ⛔️ {food_name} ({toman_str}) [مهلت تمام شده]\n"
                    else:
                        text += f"   ▫️ {food_name} ({toman_str})\n"
                        buttons.append(
                            [
                                InlineKeyboardButton(
                                    f"➕ رزرو {food_name} ({toman_str})",
                                    callback_data=f"do_reserve_{prog_id}_{food_type_id}_{meal_type_id}_{day_idx}",
                                )
                            ]
                        )

        buttons.append(
            [InlineKeyboardButton("🔙 بازگشت به لیست روزها", callback_data="buy_weekly_start")]
        )

        await query.edit_message_text(
            text, parse_mode="HTML", reply_markup=InlineKeyboardMarkup(buttons)
        )

    except SamadAPIError as e:
        await query.message.reply_html(f"❌ {e.message}")
    except Exception as e:
        await query.message.reply_html(f"❌ خطا: {str(e)}")
    finally:
        await client.close()


async def do_reserve_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Executes meal reservation."""
    query = update.callback_query
    # data: do_reserve_{prog_id}_{food_type_id}_{meal_type_id}_{day_idx}
    parts = query.data.replace("do_reserve_", "").split("_")
    prog_id = int(parts[0])
    food_type_id = int(parts[1])
    meal_type_id = int(parts[2])
    day_idx = int(parts[3])

    client = await check_authenticated(update, context)
    if not client:
        return

    try:
        msg = await client.set_food_reservation(
            program_id=prog_id,
            food_type_id=food_type_id,
            meal_type_id=meal_type_id,
            selected=True,
        )
        await query.answer(f"✅ {msg}", show_alert=True)
        # Refresh the day view
        query.data = f"buy_view_day_{day_idx}"
        await buy_view_day_callback(update, context)
    except SamadAPIError as e:
        await query.answer(f"❌ {e.message}", show_alert=True)
    except Exception as e:
        await query.answer(f"❌ خطا: {str(e)}", show_alert=True)
    finally:
        await client.close()


async def do_cancel_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Executes meal cancellation."""
    query = update.callback_query
    # data: do_cancel_{prog_id}_{food_type_id}_{meal_type_id}_{day_idx}
    parts = query.data.replace("do_cancel_", "").split("_")
    prog_id = int(parts[0])
    food_type_id = int(parts[1])
    meal_type_id = int(parts[2])
    day_idx = int(parts[3])

    client = await check_authenticated(update, context)
    if not client:
        return

    try:
        msg = await client.set_food_reservation(
            program_id=prog_id,
            food_type_id=food_type_id,
            meal_type_id=meal_type_id,
            selected=False,
        )
        await query.answer(f"✅ {msg}", show_alert=True)
        # Refresh the day view
        query.data = f"buy_view_day_{day_idx}"
        await buy_view_day_callback(update, context)
    except SamadAPIError as e:
        await query.answer(f"❌ {e.message}", show_alert=True)
    except Exception as e:
        await query.answer(f"❌ خطا: {str(e)}", show_alert=True)
    finally:
        await client.close()


async def daily_sales_list_callback(
    update: Update, context: ContextTypes.DEFAULT_TYPE
):
    """Lists current daily sale (surplus meals) available for immediate purchase."""
    query = update.callback_query
    await query.answer()

    client = await check_authenticated(update, context)
    if not client:
        return

    status_msg = await query.message.reply_html("⏳ در حال دریافت لیست غذاهای فروش روزانه...")

    try:
        sales = await client.get_daily_sell_programs()
        await status_msg.delete()

        if not sales:
            text = (
                "⚡️ <b>سامانه فروش روزانه (غذاهای مازاد)</b>\n\n"
                "ℹ️ در حال حاضر هیچ غذایی برای فروش روزانه در سلف‌ها موجود نیست.\n"
                "<i>(غذاهای فروش روزانه معمولاً نزدیک ساعت سرو و در صورت وجود مازاد اضافه می‌شوند)</i>"
            )
            buttons = [
                [InlineKeyboardButton("🔄 بروزرسانی مجدد", callback_data="daily_sales_list")]
            ]
            await query.message.reply_html(
                text, reply_markup=InlineKeyboardMarkup(buttons)
            )
            return

        text = (
            "⚡️ <b>غذاهای مازاد آماده خرید (فروش روزانه):</b>\n"
            "برای خرید فوری روی غذای مورد نظر کلیک کنید:\n"
            "─────────────────\n"
        )

        buttons = []
        for item in sales:
            reserve_id = item.get("id") or item.get("reserveId")
            food_name = item.get("foodName") or item.get("foodNames") or "غذا"
            self_name = item.get("selfName") or item.get("self", "سلف")
            price = item.get("price", 0)
            meal_title = item.get("mealTitle") or item.get("mealTypeTitle") or "ناهار"

            text += (
                f"🍱 <b>{food_name}</b> ({meal_title})\n"
                f"🏛 {self_name} | 💰 {format_toman(price)}\n"
                "─────────────────\n"
            )

            if reserve_id:
                buttons.append(
                    [
                        InlineKeyboardButton(
                            f"⚡️ خرید {food_name}",
                            callback_data=f"buy_daily_{reserve_id}",
                        )
                    ]
                )

        buttons.append(
            [InlineKeyboardButton("🔄 بروزرسانی", callback_data="daily_sales_list")]
        )

        await query.message.reply_html(
            text, reply_markup=InlineKeyboardMarkup(buttons)
        )

    except SamadAPIError as e:
        await status_msg.delete()
        await query.message.reply_html(f"❌ {e.message}")
    except Exception as e:
        await status_msg.delete()
        await query.message.reply_html(f"❌ خطا: {str(e)}")
    finally:
        await client.close()


async def buy_daily_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Executes purchase of daily sale food."""
    query = update.callback_query
    await query.answer("در حال ثبت خرید...")

    reserve_id_str = query.data.replace("buy_daily_", "")
    reserve_id = int(reserve_id_str)

    client = await check_authenticated(update, context)
    if not client:
        return

    try:
        msg = await client.reserve_daily_sell(reserve_id)

        # Automatically get forget code / QR code for instant cafeteria delivery
        qr_bio = None
        code_text = ""
        try:
            code_data = await client.get_forget_code(reserve_id, daily_sale=True)
            forgot_code = code_data.get("forgotCardCode")
            if forgot_code:
                qr_bio = generate_qr_code(forgot_code)
                code_text = f"\n\n🎫 <b>کد تحویل فوری:</b> <code>{forgot_code}</code>"
        except Exception:
            pass

        success_msg = f"✅ <b>خرید با موفقیت ثبت شد!</b>\n{msg}{code_text}"

        if qr_bio:
            await query.message.reply_photo(
                photo=qr_bio, caption=success_msg, parse_mode="HTML"
            )
        else:
            await query.message.reply_html(success_msg)

    except SamadAPIError as e:
        await query.message.reply_html(f"❌ {e.message}")
    except Exception as e:
        await query.message.reply_html(f"❌ خطا در خرید روزانه: {e}")
    finally:
        await client.close()
