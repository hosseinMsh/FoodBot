import asyncio
from datetime import datetime
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes
import database
from samad_client import SamadClient, SamadAPIError
from handlers.common import check_authenticated
from date_helper import (
    get_next_week_saturday_str,
    format_toman,
    normalize_weekly_programs,
)


async def next_week_food_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles '📅 لیست غذاهای هفته بعدی' command."""
    client = await check_authenticated(update, context)
    if not client:
        return

    telegram_id = update.effective_user.id
    user_db = await database.get_user(telegram_id)
    self_id = user_db.get("selected_self_id") if user_db else None
    self_name = user_db.get("selected_self_name") if user_db else None

    # If no self selected, fetch available and select first
    if not self_id:
        try:
            selfs = await client.get_available_selfs()
            if selfs:
                target_self = selfs[0]
                for s in selfs:
                    if "مرکزی" in s.get("name", ""):
                        target_self = s
                        break
                self_id = target_self["id"]
                self_name = target_self["name"]
                await database.update_selected_self(telegram_id, self_id, self_name)
            else:
                await update.effective_chat.send_message(
                    "❌ سلفی برای حساب شما یافت نشد."
                )
                await client.close()
                return
        except Exception as e:
            await update.effective_chat.send_message(f"❌ خطا در دریافت سلف‌ها: {e}")
            await client.close()
            return

    status_msg = await update.effective_chat.send_message(
        f"⏳ در حال بارگذاری برنامه غذایی هفته بعد ({self_name})..."
    )

    try:
        next_week_sat = get_next_week_saturday_str()
        prog_data = await client.get_reservable_programs(self_id, next_week_sat)

        self_info = prog_data.get("self", {})
        active_self_name = self_info.get("name", self_name)
        days = normalize_weekly_programs(prog_data)

        await status_msg.delete()

        if not days:
            text = (
                f"📅 <b>برنامه غذایی هفته بعد</b>\n"
                f"🏛 <b>سلف:</b> {active_self_name}\n\n"
                "ℹ️ هنوز برنامه غذایی‌ای برای هفته آینده در این سلف بارگذاری نشده است."
            )
            buttons = [
                [
                    InlineKeyboardButton(
                        "🌐 دیدن لیست غذای همه سلف‌ها",
                        callback_data="all_selfs_overview",
                    )
                ],
                [
                    InlineKeyboardButton(
                        "🔄 انتخاب سلف دیگر", callback_data="browse_all_selfs"
                    )
                ],
            ]
            await update.effective_chat.send_message(
                text, parse_mode="HTML", reply_markup=InlineKeyboardMarkup(buttons)
            )
            return

        text = (
            f"📅 <b>برنامه غذایی هفته آینده</b>\n"
            f"🏛 <b>سلف:</b> {active_self_name}\n"
            f"─────────────────\n"
        )

        for day in days:
            day_name = day.get("dayTranslated", "")
            date_jstr = day.get("dateJStr", "")
            meals = day.get("meals", [])

            text += f"\n🗓 <b>{day_name} ({date_jstr})</b>\n"

            if not meals:
                text += "   <i>غذا سرو نمی‌شود / تعطیل</i>\n"
                continue

            for meal in meals:
                meal_title = meal.get("mealTypeTitle", "")
                text += f"▪️ <b>{meal_title}:</b>\n"

                foods = meal.get("foods", [])
                for f in foods:
                    food_name = f.get("foodName", "")
                    price = f.get("price", 0)
                    is_reserved = f.get("isReserved", False)
                    rule_violated = f.get("reserveRuleViolated", False)

                    icon = "✅ [رزرو شده]" if is_reserved else "▫️"
                    status = " (مهلت به پایان رسیده ❌)" if rule_violated else ""

                    text += f"   {icon} {food_name} - {format_toman(price)}{status}\n"

        buttons = [
            [
                InlineKeyboardButton(
                    "🌐 دیدن لیست غذای هفته بعد در همه سلف‌ها",
                    callback_data="all_selfs_overview",
                )
            ],
            [
                InlineKeyboardButton(
                    "🏢 مشاهده سلف‌های دیگر",
                    callback_data="browse_all_selfs",
                )
            ],
            [
                InlineKeyboardButton(
                    "🛒 شروع رزرو / تغییر غذاهای هفته بعد",
                    callback_data="start_weekly_reserve",
                )
            ],
        ]

        if len(text) > 4000:
            parts = [text[i : i + 3900] for i in range(0, len(text), 3900)]
            for p in parts[:-1]:
                await update.effective_chat.send_message(p, parse_mode="HTML")
            await update.effective_chat.send_message(
                parts[-1],
                parse_mode="HTML",
                reply_markup=InlineKeyboardMarkup(buttons),
            )
        else:
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


async def all_selfs_overview_callback(
    update: Update, context: ContextTypes.DEFAULT_TYPE
):
    """
    Shows day selection buttons to view and compare food across ALL selfs for next week.
    """
    query = update.callback_query
    await query.answer()

    client = await check_authenticated(update, context)
    if not client:
        return

    text = (
        "🌐 <b>برنامه غذایی هفته بعد در همه سلف‌ها</b>\n\n"
        "برای مشاهده و مقایسه غذاهای کلیه سالن‌های غذاخوری (سلف مرکزی، کلانا، یونی‌فود، کاله، فست‌فود و...)، "
        "روز مد نظر را انتخاب کنید:\n"
    )

    buttons = [
        [
            InlineKeyboardButton("🗓 شنبه", callback_data="all_selfs_day_0"),
            InlineKeyboardButton("🗓 یکشنبه", callback_data="all_selfs_day_1"),
        ],
        [
            InlineKeyboardButton("🗓 دوشنبه", callback_data="all_selfs_day_2"),
            InlineKeyboardButton("🗓 سه‌شنبه", callback_data="all_selfs_day_3"),
        ],
        [
            InlineKeyboardButton("🗓 چهارشنبه", callback_data="all_selfs_day_4"),
        ],
        [
            InlineKeyboardButton("🏢 مشاهده منوی کامل یک سلف", callback_data="browse_all_selfs")
        ],
    ]

    await query.message.reply_html(
        text, reply_markup=InlineKeyboardMarkup(buttons)
    )
    await client.close()


async def all_selfs_day_callback(
    update: Update, context: ContextTypes.DEFAULT_TYPE
):
    """
    Fetches and displays food menus of ALL selfs for a specific day of next week.
    """
    query = update.callback_query
    data = query.data
    day_idx = int(data.replace("all_selfs_day_", ""))

    await query.answer("در حال استعلام منوی همه سلف‌ها...")

    client = await check_authenticated(update, context)
    if not client:
        return

    status_msg = await query.message.reply_html(
        "⏳ در حال دریافت منوی غذای همه سلف‌ها به صورت همزمان..."
    )

    try:
        selfs = await client.get_available_selfs()
        if not selfs:
            await status_msg.delete()
            await query.message.reply_html("❌ هیچ سلفی در دسترس نیست.")
            return

        next_sat = get_next_week_saturday_str()

        # Fetch all selfs in parallel
        async def fetch_self_programs(s):
            try:
                res = await client.get_reservable_programs(s["id"], next_sat)
                days = normalize_weekly_programs(res)
                return s["name"], s["id"], days
            except Exception:
                return s["name"], s["id"], []

        results = await asyncio.gather(*(fetch_self_programs(s) for s in selfs))
        await status_msg.delete()

        # Find target day name and date
        target_day_name = ""
        target_date_jstr = ""

        self_foods = []
        for sname, sid, days in results:
            if day_idx < len(days):
                day_info = days[day_idx]
                if not target_day_name:
                    target_day_name = day_info.get("dayTranslated", "")
                    target_date_jstr = day_info.get("dateJStr", "")

                items = []
                for meal in day_info.get("meals", []):
                    m_title = meal.get("mealTypeTitle", "ناهار")
                    for f in meal.get("foods", []):
                        items.append(
                            {
                                "meal": m_title,
                                "name": f.get("foodName", ""),
                                "price": f.get("price", 0),
                                "is_reserved": f.get("isReserved", False),
                            }
                        )
                if items:
                    self_foods.append((sname, items))

        if not target_day_name:
            day_names = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه"]
            target_day_name = day_names[day_idx] if day_idx < len(day_names) else ""

        text = (
            f"📅 <b>منوی همه سلف‌ها برای {target_day_name} ({target_date_jstr}):</b>\n"
            "─────────────────\n"
        )

        if not self_foods:
            text += "\n<i>در این روز برنامه‌ای برای سلف‌ها ثبت نشده است.</i>\n"
        else:
            for sname, items in self_foods:
                text += f"\n🏛 <b>{sname}:</b>\n"
                for item in items:
                    price_toman = format_toman(item["price"])
                    res_tag = " [✅ رزرو شده]" if item["is_reserved"] else ""
                    text += f"   ▫️ {item['name']} ({price_toman}){res_tag}\n"

        # Navigation buttons for next/prev day
        nav_row = []
        if day_idx > 0:
            nav_row.append(
                InlineKeyboardButton("⬅️ روز قبل", callback_data=f"all_selfs_day_{day_idx - 1}")
            )
        if day_idx < 4:
            nav_row.append(
                InlineKeyboardButton("روز بعد ➡️", callback_data=f"all_selfs_day_{day_idx + 1}")
            )

        buttons = []
        if nav_row:
            buttons.append(nav_row)
        buttons.append(
            [InlineKeyboardButton("📅 انتخاب روز دیگر", callback_data="all_selfs_overview")]
        )
        buttons.append(
            [InlineKeyboardButton("🛒 شروع رزرو این روز", callback_data=f"buy_view_day_{day_idx}")]
        )

        if len(text) > 4000:
            parts = [text[i : i + 3900] for i in range(0, len(text), 3900)]
            for p in parts[:-1]:
                await query.message.reply_html(p)
            await query.message.reply_html(
                parts[-1], reply_markup=InlineKeyboardMarkup(buttons)
            )
        else:
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


async def browse_all_selfs_callback(
    update: Update, context: ContextTypes.DEFAULT_TYPE
):
    """
    Lists all available selfs so user can view full weekly program of any specific self.
    """
    query = update.callback_query
    await query.answer()

    client = await check_authenticated(update, context)
    if not client:
        return

    try:
        selfs = await client.get_available_selfs()
        if not selfs:
            await query.message.reply_html("❌ سلفی برای حساب شما یافت نشد.")
            return

        text = (
            "🏢 <b>مشاهده برنامه هفتگی سلف‌ها</b>\n\n"
            "برای دیدن برنامه غذایی کامل یک سلف در طول هفته آینده، روی آن کلیک کنید:"
        )

        buttons = []
        for s in selfs:
            buttons.append(
                [
                    InlineKeyboardButton(
                        f"🏛 {s['name']}",
                        callback_data=f"view_self_menu_{s['id']}",
                    )
                ]
            )

        buttons.append(
            [
                InlineKeyboardButton(
                    "🌐 مقایسه همه سلف‌ها (روز به روز)",
                    callback_data="all_selfs_overview",
                )
            ]
        )

        await query.message.reply_html(
            text, reply_markup=InlineKeyboardMarkup(buttons)
        )
    except Exception as e:
        await query.message.reply_html(f"❌ خطا: {e}")
    finally:
        await client.close()


async def view_self_menu_callback(
    update: Update, context: ContextTypes.DEFAULT_TYPE
):
    """
    Views full next week program for a chosen self.
    """
    query = update.callback_query
    await query.answer()

    data_str = query.data.replace("view_self_menu_", "").split("_")[0]
    self_id = int(data_str)

    client = await check_authenticated(update, context)
    if not client:
        return

    self_name = "سلف"
    try:
        selfs = await client.get_available_selfs()
        for s in selfs:
            if s.get("id") == self_id:
                self_name = s.get("name", "سلف")
                break
    except Exception:
        pass

    status_msg = await query.message.reply_html(
        f"⏳ در حال بارگذاری برنامه غذایی {self_name}..."
    )

    try:
        next_week_sat = get_next_week_saturday_str()
        prog_data = await client.get_reservable_programs(self_id, next_week_sat)
        days = normalize_weekly_programs(prog_data)

        await status_msg.delete()

        if not days:
            text = (
                f"📅 <b>برنامه غذایی هفته بعد</b>\n"
                f"🏛 <b>سلف:</b> {self_name}\n\n"
                "ℹ️ هنوز برنامه غذایی‌ای برای هفته آینده در این سلف تعریف نشده است."
            )
            buttons = [
                [InlineKeyboardButton("🏢 بازگشت به لیست سلف‌ها", callback_data="browse_all_selfs")]
            ]
            await query.message.reply_html(
                text, reply_markup=InlineKeyboardMarkup(buttons)
            )
            return

        text = (
            f"📅 <b>برنامه غذایی هفته آینده</b>\n"
            f"🏛 <b>سلف:</b> {self_name}\n"
            f"─────────────────\n"
        )

        for day in days:
            day_name = day.get("dayTranslated", "")
            date_jstr = day.get("dateJStr", "")
            meals = day.get("meals", [])

            text += f"\n🗓 <b>{day_name} ({date_jstr})</b>\n"

            for meal in meals:
                meal_title = meal.get("mealTypeTitle", "")
                text += f"▪️ <b>{meal_title}:</b>\n"

                foods = meal.get("foods", [])
                for f in foods:
                    food_name = f.get("foodName", "")
                    price = f.get("price", 0)
                    is_reserved = f.get("isReserved", False)
                    rule_violated = f.get("reserveRuleViolated", False)

                    icon = "✅ [رزرو شده]" if is_reserved else "▫️"
                    status = " (مهلت تمام شده ❌)" if rule_violated else ""

                    text += f"   {icon} {food_name} - {format_toman(price)}{status}\n"

        buttons = [
            [
                InlineKeyboardButton(
                    f"✅ انتخاب به عنوان سلف پیش‌فرض من",
                    callback_data=f"set_self_{self_id}",
                )
            ],
            [
                InlineKeyboardButton(
                    "🏢 مشاهده سایر سلف‌ها",
                    callback_data="browse_all_selfs",
                )
            ],
            [
                InlineKeyboardButton(
                    "🌐 مقایسه همه سلف‌ها (روز به روز)",
                    callback_data="all_selfs_overview",
                )
            ],
        ]

        if len(text) > 4000:
            parts = [text[i : i + 3900] for i in range(0, len(text), 3900)]
            for p in parts[:-1]:
                await query.message.reply_html(p)
            await query.message.reply_html(
                parts[-1], reply_markup=InlineKeyboardMarkup(buttons)
            )
        else:
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
