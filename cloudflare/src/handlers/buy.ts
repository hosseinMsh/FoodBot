import { Composer, Context, InlineKeyboard, InputFile } from "grammy";
import { BotContextOptions, BTN_BUY, getAuthenticatedClient } from "./common";
import * as db from "../db";
import { getNextWeekSaturdayStr, normalizeWeeklyPrograms, formatToman } from "../date";
import { generateQrPng } from "../qr";

export function createBuyComposer(options: BotContextOptions): Composer<Context> {
  const composer = new Composer<Context>();
  const { env } = options;

  // ---------------- /buy ----------------
  const handleBuy = async (ctx: Context) => {
    const text =
      "🛒 <b>خرید و رزرو غذا</b>\n\n" +
      "لطفاً یکی از روش‌های زیر را انتخاب کنید:\n\n" +
      "1️⃣ <b>رزرو برنامه غذایی هفته آینده:</b>\n" +
      "رزرو ناهار یا شام از منوی هفتگی با نرخ مصوب دانشجویی.\n\n" +
      "2️⃣ <b>خرید فوری از فروش روزانه:</b>\n" +
      "خرید غذاهای مازاد آماده توزیع برای امروز بدون نیاز به رزرو قبلی.";

    const kb = new InlineKeyboard()
      .text("📅 رزرو برنامه غذایی هفته آینده", "buy_weekly_start")
      .row()
      .text("⚡️ خرید فوری از فروش روزانه", "daily_sales_list");

    await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
  };

  composer.command("buy", handleBuy);
  composer.hears(BTN_BUY, handleBuy);

  composer.callbackQuery(/^start_weekly_reserve|buy_weekly_start$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const client = await getAuthenticatedClient(ctx, options);
    if (!client) return;

    const telegramId = ctx.from!.id;
    const userDb = await db.getUser(env.DB, telegramId);
    const selfId = userDb?.selected_self_id || 1;
    const selfName = userDb?.selected_self_name || "سلف";

    try {
      const nextSat = getNextWeekSaturdayStr();
      const progData = await client.getReservablePrograms(selfId, nextSat);
      const days = normalizeWeeklyPrograms(progData);

      if (days.length === 0) {
        await ctx.reply(`❌ برنامه غذایی هفته آینده برای <b>${selfName}</b> هنوز تعریف نشده است.`, {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard().text("🔄 تغییر سلف", "browse_all_selfs"),
        });
        return;
      }

      const text =
        `📅 <b>رزرو غذاهای هفته بعد</b>\n` +
        `🏛 <b>سلف:</b> ${selfName}\n\n` +
        "برای مشاهده وعده‌ها و ثبت رزرو، روی روز مورد نظر کلیک کنید:";

      const kb = new InlineKeyboard();
      for (let idx = 0; idx < days.length; idx++) {
        const d = days[idx];
        kb.text(`🗓 ${d.dayTranslated} (${d.dateJStr})`, `buy_view_day_${idx}`).row();
      }
      kb.text("🏛 تغییر سلف", "browse_all_selfs");

      await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
    } catch (e: any) {
      await ctx.reply(`❌ خطا: ${e.message}`);
    }
  });

  composer.callbackQuery(/^buy_view_day_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const dayIdx = parseInt(ctx.match[1], 10);
    const client = await getAuthenticatedClient(ctx, options);
    if (!client) return;

    const telegramId = ctx.from!.id;
    const userDb = await db.getUser(env.DB, telegramId);
    const selfId = userDb?.selected_self_id || 1;
    const selfName = userDb?.selected_self_name || "سلف";

    try {
      const nextSat = getNextWeekSaturdayStr();
      const progData = await client.getReservablePrograms(selfId, nextSat);
      const days = normalizeWeeklyPrograms(progData);

      if (dayIdx >= days.length) {
        await ctx.reply("روز انتخابی نامعتبر است.");
        return;
      }

      const day = days[dayIdx];
      let text = `🗓 <b>${day.dayTranslated} (${day.dateJStr})</b>\n🏛 <b>سلف:</b> ${selfName}\n─────────────────\n`;

      const kb = new InlineKeyboard();
      for (const meal of day.meals) {
        text += `\n▪️ <b>وعده ${meal.mealTypeTitle}:</b>\n`;
        for (const f of meal.foods) {
          const tomanStr = `${Math.floor(f.price / 10).toLocaleString("fa-IR")} تومان`;
          if (f.isReserved) {
            text += `   ✅ <b>${f.foodName}</b> (${tomanStr}) [رزرو شده]\n`;
            kb.text(`❌ لغو ${f.foodName}`, `do_cancel_${f.programId}_${f.foodTypeId}_${meal.mealTypeId}_${dayIdx}`).row();
          } else if (f.reserveRuleViolated) {
            text += `   ⛔️ ${f.foodName} (${tomanStr}) [مهلت تمام شده]\n`;
          } else {
            text += `   ▫️ ${f.foodName} (${tomanStr})\n`;
            kb.text(`➕ رزرو ${f.foodName} (${tomanStr})`, `do_reserve_${f.programId}_${f.foodTypeId}_${meal.mealTypeId}_${dayIdx}`).row();
          }
        }
      }
      kb.text("🔙 بازگشت به لیست روزها", "buy_weekly_start");

      await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
    } catch (e: any) {
      await ctx.reply(`❌ خطا: ${e.message}`);
    }
  });

  composer.callbackQuery(/^do_reserve_(\d+)_(\d+)_(\d+)_(\d+)$/, async (ctx) => {
    const progId = parseInt(ctx.match[1], 10);
    const foodTypeId = parseInt(ctx.match[2], 10);
    const mealTypeId = parseInt(ctx.match[3], 10);

    const client = await getAuthenticatedClient(ctx, options);
    if (!client) return;

    try {
      const msg = await client.setFoodReservation(progId, foodTypeId, mealTypeId, true);
      await ctx.answerCallbackQuery({ text: `✅ ${msg}`, show_alert: true });
    } catch (e: any) {
      await ctx.answerCallbackQuery({ text: `❌ ${e.message}`, show_alert: true });
    }
  });

  composer.callbackQuery(/^do_cancel_(\d+)_(\d+)_(\d+)_(\d+)$/, async (ctx) => {
    const progId = parseInt(ctx.match[1], 10);
    const foodTypeId = parseInt(ctx.match[2], 10);
    const mealTypeId = parseInt(ctx.match[3], 10);

    const client = await getAuthenticatedClient(ctx, options);
    if (!client) return;

    try {
      const msg = await client.setFoodReservation(progId, foodTypeId, mealTypeId, false);
      await ctx.answerCallbackQuery({ text: `✅ ${msg}`, show_alert: true });
    } catch (e: any) {
      await ctx.answerCallbackQuery({ text: `❌ ${e.message}`, show_alert: true });
    }
  });

  // ---------------- فروش روزانه (Daily sales) ----------------
  composer.callbackQuery("daily_sales_list", async (ctx) => {
    await ctx.answerCallbackQuery();
    const client = await getAuthenticatedClient(ctx, options);
    if (!client) return;

    const waitMsg = await ctx.reply("⏳ در حال استعلام غذاهای فروش روزانه...");
    try {
      const sales = await client.getDailySellPrograms();
      await ctx.api.deleteMessage(ctx.chat!.id, waitMsg.message_id).catch(() => {});

      if (sales.length === 0) {
        const text =
          "⚡️ <b>سامانه فروش روزانه (غذاهای مازاد)</b>\n\n" +
          "ℹ️ در حال حاضر هیچ غذایی برای فروش روزانه در سلف‌ها موجود نیست.\n" +
          "<i>(غذاهای فروش روزانه معمولاً نزدیک ساعت توزیع اضافه می‌شوند)</i>";
        const kb = new InlineKeyboard().text("🔄 بروزرسانی مجدد", "daily_sales_list");
        await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
        return;
      }

      let text = "⚡️ <b>غذاهای مازاد آماده خرید (فروش روزانه):</b>\nبرای خرید فوری روی غذا کلیک کنید:\n─────────────────\n";
      const kb = new InlineKeyboard();

      for (const item of sales) {
        const resId = item.id || item.reserveId;
        const foodName = item.foodName || item.foodNames || "غذا";
        const selfName = item.selfName || item.self || "سلف";
        const price = item.price || 0;
        const mealTitle = item.mealTitle || item.mealTypeTitle || "ناهار";

        text += `🍱 <b>${foodName}</b> (${mealTitle})\n🏛 ${selfName} | 💰 ${formatToman(price)}\n─────────────────\n`;
        if (resId) {
          kb.text(`⚡️ خرید فوری ${foodName}`, `buy_daily_${resId}`).row();
        }
      }
      kb.text("🔄 بروزرسانی", "daily_sales_list");

      await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
    } catch (e: any) {
      await ctx.api.deleteMessage(ctx.chat!.id, waitMsg.message_id).catch(() => {});
      await ctx.reply(`❌ خطا: ${e.message}`);
    }
  });

  composer.callbackQuery(/^buy_daily_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery("در حال ثبت خرید...");
    const client = await getAuthenticatedClient(ctx, options);
    if (!client) return;

    const reserveId = parseInt(ctx.match[1], 10);
    try {
      const msg = await client.reserveDailySell(reserveId);
      let forgotCode = "";
      try {
        const codeData = await client.getForgetCode(reserveId, true);
        forgotCode = codeData.forgotCardCode;
      } catch {}

      const successMsg =
        `✅ <b>خرید با موفقیت ثبت شد!</b>\n${msg}` +
        (forgotCode ? `\n\n🎫 <b>کد تحویل فوری:</b> <code>${forgotCode}</code>` : "");

      if (forgotCode) {
        const qrBuffer = generateQrPng(forgotCode);
        await ctx.replyWithPhoto(new InputFile(qrBuffer, "qr.png"), {
          caption: successMsg,
          parse_mode: "HTML",
        });
      } else {
        await ctx.reply(successMsg, { parse_mode: "HTML" });
      }
    } catch (e: any) {
      await ctx.reply(`❌ خطا در خرید روزانه: ${e.message}`);
    }
  });

  return composer;
}
