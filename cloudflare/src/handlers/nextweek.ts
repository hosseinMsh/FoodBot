import { Composer, Context, InlineKeyboard } from "grammy";
import { BotContextOptions, BTN_NEXT_WEEK, getAuthenticatedClient } from "./common";
import * as db from "../db";
import { getNextWeekSaturdayStr, normalizeWeeklyPrograms, formatToman } from "../date";

export function createNextWeekComposer(options: BotContextOptions): Composer<Context> {
  const composer = new Composer<Context>();
  const { env } = options;

  // ---------------- /nextweek ----------------
  const handleNextWeek = async (ctx: Context) => {
    const client = await getAuthenticatedClient(ctx, options);
    if (!client) return;

    const telegramId = ctx.from!.id;
    const userDb = await db.getUser(env.DB, telegramId);
    let selfId = userDb?.selected_self_id;
    let selfName = userDb?.selected_self_name;

    if (!selfId) {
      const selfs = await client.getAvailableSelfs();
      if (selfs.length > 0) {
        let target = selfs[0];
        for (const s of selfs) {
          if (s.name && s.name.includes("مرکزی")) {
            target = s;
            break;
          }
        }
        selfId = target.id;
        selfName = target.name;
        await db.updateSelectedSelf(env.DB, telegramId, target.id, selfName || "سلف");
      } else {
        await ctx.reply("❌ سلفی برای حساب شما یافت نشد.");
        return;
      }
    }

    const activeSelfId = selfId!;
    const activeSelfName = selfName || "سلف";

    const waitMsg = await ctx.reply(`⏳ در حال بارگذاری برنامه غذایی هفته بعد (${activeSelfName})...`);
    try {
      const nextWeekSat = getNextWeekSaturdayStr();
      const progData = await client.getReservablePrograms(activeSelfId, nextWeekSat);
      const days = normalizeWeeklyPrograms(progData);

      await ctx.api.deleteMessage(ctx.chat!.id, waitMsg.message_id).catch(() => {});

      if (days.length === 0) {
        const text =
          `📅 <b>برنامه غذایی هفته بعد</b>\n` +
          `🏛 <b>سلف:</b> ${selfName}\n\n` +
          "ℹ️ هنوز برنامه غذایی‌ای برای هفته آینده در این سلف بارگذاری نشده است.";
        const kb = new InlineKeyboard()
          .text("🌐 دیدن لیست غذای همه سلف‌ها", "all_selfs_overview")
          .row()
          .text("🔄 انتخاب سلف دیگر", "browse_all_selfs");
        await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
        return;
      }

      let text = `📅 <b>برنامه غذایی هفته آینده</b>\n` + `🏛 <b>سلف:</b> ${selfName}\n` + "─────────────────\n";

      for (const day of days) {
        text += `\n🗓 <b>${day.dayTranslated} (${day.dateJStr})</b>\n`;
        if (day.meals.length === 0) {
          text += "   <i>غذا سرو نمی‌شود / تعطیل</i>\n";
          continue;
        }

        for (const meal of day.meals) {
          text += `▪️ <b>${meal.mealTypeTitle}:</b>\n`;
          for (const f of meal.foods) {
            const icon = f.isReserved ? "✅ [رزرو شده]" : "▫️";
            const status = f.reserveRuleViolated ? " (مهلت تمام شده ❌)" : "";
            text += `   ${icon} ${f.foodName} - ${formatToman(f.price)}${status}\n`;
          }
        }
      }

      const kb = new InlineKeyboard()
        .text("🌐 دیدن لیست غذای هفته بعد در همه سلف‌ها", "all_selfs_overview")
        .row()
        .text("🏢 مشاهده سلف‌های دیگر", "browse_all_selfs")
        .row()
        .text("🛒 شروع رزرو / تغییر غذاهای هفته بعد", "buy_weekly_start");

      await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
    } catch (e: any) {
      await ctx.api.deleteMessage(ctx.chat!.id, waitMsg.message_id).catch(() => {});
      await ctx.reply(`❌ خطا: ${e.message}`);
    }
  };

  composer.command("nextweek", handleNextWeek);
  composer.hears(BTN_NEXT_WEEK, handleNextWeek);

  // ---------------- همه سلف‌ها (مقایسه روز به روز) ----------------
  composer.callbackQuery("all_selfs_overview", async (ctx) => {
    await ctx.answerCallbackQuery();
    const text =
      "🌐 <b>برنامه غذایی هفته بعد در همه سلف‌ها</b>\n\n" +
      "برای مشاهده و مقایسه غذاهای کلیه سالن‌های غذاخوری (سلف مرکزی، کلانا، یونی‌فود، کاله، فست‌فود و...)، " +
      "روز مد نظر را انتخاب کنید:\n";

    const kb = new InlineKeyboard()
      .text("🗓 شنبه", "all_selfs_day_0")
      .text("🗓 یکشنبه", "all_selfs_day_1")
      .row()
      .text("🗓 دوشنبه", "all_selfs_day_2")
      .text("🗓 سه‌شنبه", "all_selfs_day_3")
      .row()
      .text("🗓 چهارشنبه", "all_selfs_day_4")
      .row()
      .text("🏢 مشاهده منوی کامل یک سلف", "browse_all_selfs");

    await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
  });

  composer.callbackQuery(/^all_selfs_day_(\d+)$/, async (ctx) => {
    const dayIdx = parseInt(ctx.match[1], 10);
    await ctx.answerCallbackQuery("در حال دریافت منوی همه سلف‌ها...");
    const client = await getAuthenticatedClient(ctx, options);
    if (!client) return;

    const waitMsg = await ctx.reply("⏳ در حال استعلام همزمان منوی همه سلف‌ها...");
    try {
      const selfs = await client.getAvailableSelfs();
      const nextSat = getNextWeekSaturdayStr();

      // Parallel fetch across all cafeterias
      const results = await Promise.all(
        selfs.map(async (s: any) => {
          try {
            const res = await client.getReservablePrograms(s.id, nextSat);
            const days = normalizeWeeklyPrograms(res);
            return { name: s.name, id: s.id, days };
          } catch {
            return { name: s.name, id: s.id, days: [] };
          }
        })
      );

      await ctx.api.deleteMessage(ctx.chat!.id, waitMsg.message_id).catch(() => {});

      let targetDayName = "";
      let targetDateJStr = "";
      const selfFoods: { sname: string; items: any[] }[] = [];

      for (const res of results) {
        if (dayIdx < res.days.length) {
          const d = res.days[dayIdx];
          if (!targetDayName) {
            targetDayName = d.dayTranslated;
            targetDateJStr = d.dateJStr;
          }

          const items: any[] = [];
          for (const m of d.meals) {
            for (const f of m.foods) {
              items.push({
                name: f.foodName,
                price: f.price,
                isReserved: f.isReserved,
              });
            }
          }
          if (items.length > 0) {
            selfFoods.push({ sname: res.name, items });
          }
        }
      }

      if (!targetDayName) {
        const names = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه"];
        targetDayName = names[dayIdx] || "روز انتخابی";
      }

      let text = `📅 <b>منوی همه سلف‌ها برای ${targetDayName} (${targetDateJStr}):</b>\n─────────────────\n`;
      for (const sf of selfFoods) {
        text += `\n🏛 <b>${sf.sname}:</b>\n`;
        for (const item of sf.items) {
          const resTag = item.isReserved ? " [✅ رزرو شده]" : "";
          text += `   ▫️ ${item.name} (${formatToman(item.price)})${resTag}\n`;
        }
      }

      const kb = new InlineKeyboard();
      const navRow = [];
      if (dayIdx > 0) navRow.push({ text: "⬅️ روز قبل", callback_data: `all_selfs_day_${dayIdx - 1}` });
      if (dayIdx < 4) navRow.push({ text: "روز بعد ➡️", callback_data: `all_selfs_day_${dayIdx + 1}` });
      if (navRow.length > 0) {
        for (const btn of navRow) kb.text(btn.text, btn.callback_data);
        kb.row();
      }
      kb.text("📅 انتخاب روز دیگر", "all_selfs_overview").row();
      kb.text("🛒 شروع رزرو این روز", `buy_view_day_${dayIdx}`);

      await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
    } catch (e: any) {
      await ctx.api.deleteMessage(ctx.chat!.id, waitMsg.message_id).catch(() => {});
      await ctx.reply(`❌ خطا: ${e.message}`);
    }
  });

  // ---------------- مرور سلف‌ها (Browse by self) ----------------
  composer.callbackQuery("browse_all_selfs", async (ctx) => {
    await ctx.answerCallbackQuery();
    const client = await getAuthenticatedClient(ctx, options);
    if (!client) return;

    try {
      const selfs = await client.getAvailableSelfs();
      const text =
        "🏢 <b>مشاهده برنامه هفتگی سلف‌ها</b>\n\n" +
        "برای دیدن برنامه غذایی کامل یک سلف در طول هفته آینده، روی آن کلیک کنید:";

      const kb = new InlineKeyboard();
      for (const s of selfs) {
        kb.text(`🏛 ${s.name}`, `view_self_menu_${s.id}`).row();
      }
      kb.text("🌐 مقایسه همه سلف‌ها (روز به روز)", "all_selfs_overview");

      await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
    } catch (e: any) {
      await ctx.reply(`❌ خطا: ${e.message}`);
    }
  });

  composer.callbackQuery(/^view_self_menu_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const selfId = parseInt(ctx.match[1], 10);

    const client = await getAuthenticatedClient(ctx, options);
    if (!client) return;

    let selfName = "سلف";
    try {
      const selfs = await client.getAvailableSelfs();
      const found = selfs.find((s) => s.id === selfId);
      if (found) selfName = found.name;
    } catch {}

    const waitMsg = await ctx.reply(`⏳ در حال بارگذاری برنامه غذایی ${selfName}...`);
    try {
      const nextSat = getNextWeekSaturdayStr();
      const progData = await client.getReservablePrograms(selfId, nextSat);
      const days = normalizeWeeklyPrograms(progData);

      await ctx.api.deleteMessage(ctx.chat!.id, waitMsg.message_id).catch(() => {});

      let text = `📅 <b>برنامه غذایی هفته آینده</b>\n🏛 <b>سلف:</b> ${selfName}\n─────────────────\n`;
      for (const day of days) {
        text += `\n🗓 <b>${day.dayTranslated} (${day.dateJStr})</b>\n`;
        for (const meal of day.meals) {
          text += `▪️ <b>${meal.mealTypeTitle}:</b>\n`;
          for (const f of meal.foods) {
            const icon = f.isReserved ? "✅ [رزرو شده]" : "▫️";
            const status = f.reserveRuleViolated ? " (مهلت تمام شده ❌)" : "";
            text += `   ${icon} ${f.foodName} - ${formatToman(f.price)}${status}\n`;
          }
        }
      }

      const kb = new InlineKeyboard()
        .text("✅ انتخاب به عنوان سلف پیش‌فرض من", `set_self_${selfId}`)
        .row()
        .text("🏢 مشاهده سایر سلف‌ها", "browse_all_selfs")
        .row()
        .text("🌐 مقایسه همه سلف‌ها (روز به روز)", "all_selfs_overview");

      await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
    } catch (e: any) {
      await ctx.api.deleteMessage(ctx.chat!.id, waitMsg.message_id).catch(() => {});
      await ctx.reply(`❌ خطا: ${e.message}`);
    }
  });

  return composer;
}
