import { Composer, Context, InlineKeyboard, InputFile } from "grammy";
import { BotContextOptions, BTN_TODAY, getAuthenticatedClient } from "./common";
import * as db from "../db";
import { getTehranTodayInfo, formatToman } from "../date";
import { generateQrPng } from "../qr";

export function createTodayComposer(options: BotContextOptions): Composer<Context> {
  const composer = new Composer<Context>();
  const { env } = options;

  // ---------------- Helper for autocode panel ----------------
  const renderAutoCodePanel = (enabled: boolean) => {
    const statusText = enabled
      ? "✅ <b>فعال</b>\nهر روز <b>شنبه تا چهارشنبه ساعت ۱۱:۰۰ صبح</b>، در صورت داشتن غذای رزرو شده برای همان روز، کد تحویل و بارکد (QR Code) به صورت خودکار برایتان ارسال می‌شود."
      : "🔕 <b>غیرفعال</b>\nارسال خودکار روزانه برای شما متوقف شده است.";

    const text = `⏰ <b>ارسال خودکار کد تحویل و بارکد</b>\n\nوضعیت فعلی: ${statusText}`;
    const kb = new InlineKeyboard().text(
      enabled ? "🔕 غیرفعال کردن" : "🔔 فعال کردن",
      "toggle_autocode"
    );
    return { text, kb };
  };

  // ---------------- /autocode ----------------
  composer.command("autocode", async (ctx) => {
    const client = await getAuthenticatedClient(ctx, options);
    if (!client) return;
    const userDb = await db.getUser(env.DB, ctx.from!.id);
    const enabled = userDb?.auto_send_code !== 0;
    const { text, kb } = renderAutoCodePanel(enabled);
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
  });

  composer.callbackQuery("toggle_autocode", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;
    const userDb = await db.getUser(env.DB, telegramId);
    if (!userDb) {
      await ctx.answerCallbackQuery("ابتدا وارد حساب کاربری شوید.");
      return;
    }
    const newState = userDb.auto_send_code === 0;
    await db.setAutoSendCode(env.DB, telegramId, newState);
    await ctx.answerCallbackQuery(
      newState ? "✅ ارسال خودکار ساعت ۱۱ فعال شد." : "🔕 ارسال خودکار ساعت ۱۱ غیرفعال شد."
    );
    const { text, kb } = renderAutoCodePanel(newState);
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb }).catch(async () => {
      await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
    });
  });

  // ---------------- /today ----------------
  const handleToday = async (ctx: Context) => {
    const client = await getAuthenticatedClient(ctx, options);
    if (!client) return;

    const waitMsg = await ctx.reply("⏳ در حال دریافت اطلاعات غذای امروز...");
    try {
      const today = getTehranTodayInfo();
      const todayStr = today.isoDate;
      const todayJalali = today.jalaliDate;

      const data = await client.getReservationInfo(today.weekSaturdayStr);
      const weekDays = data.weekDays || [];

      const todayMeals: { mealTitle: string; res: any }[] = [];
      let todayDayName = today.persianDayName;

      for (const day of weekDays) {
        if (day.date === todayStr) {
          todayDayName = day.dayTranslated || "";
          for (const mt of day.mealTypes || []) {
            const mTitle = mt.name || mt.mealTypeTitle || "ناهار";
            const resList = [];
            if (mt.reserve && typeof mt.reserve === "object") resList.push(mt.reserve);
            if (Array.isArray(mt.reserves)) resList.push(...mt.reserves);

            for (const r of resList) {
              todayMeals.push({ mealTitle: mTitle, res: r });
            }
          }
        }
      }

      await ctx.api.deleteMessage(ctx.chat!.id, waitMsg.message_id).catch(() => {});

      if (todayMeals.length === 0) {
        const replyText =
          `📅 <b>امروز (${todayJalali})</b>\n\n` +
          "❌ <b>شما برای امروز هیچ غذایی رزرو نکرده‌اید.</b>\n\n" +
          "می‌توانید برای مشاهده غذاهای مازاد، از بخش «خرید از فروش روزانه» استفاده کنید.";
        const kb = new InlineKeyboard().text("⚡️ بررسی و خرید فروش روزانه", "daily_sales_list");
        await ctx.reply(replyText, { parse_mode: "HTML", reply_markup: kb });
        return;
      }

      let text = `🍽 <b>غذاهای رزرو شده برای امروز:</b>\n` + `📅 <b>${todayDayName} - ${todayJalali}</b>\n\n`;
      const kb = new InlineKeyboard();

      for (const item of todayMeals) {
        const r = item.res;
        const resId = r.id;
        const foodName = r.foodNames || r.foodName || "نامشخص";
        const selfName = r.selfName || r.self || "سلف";
        const consumed = !!r.consumed;
        const price = r.price || 0;
        const statusIcon = consumed ? "✅ تحویل گرفته شده" : "⏳ در انتظار تحویل";

        text +=
          `▪️ <b>وعده:</b> ${item.mealTitle}\n` +
          `🍱 <b>غذا:</b> ${foodName}\n` +
          `🏛 <b>سلف:</b> ${selfName}\n` +
          `💰 <b>هزینه:</b> ${formatToman(price)}\n` +
          `📌 <b>وضعیت:</b> ${statusIcon}\n` +
          `🔢 <b>شماره ژتون:</b> <code>${resId}</code>\n` +
          "─────────────────\n";

        if (!consumed && resId) {
          kb.text(`📱 دریافت بارکد / کد تحویل (${item.mealTitle})`, `forget_code_${resId}`).row();
        }
      }

      await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
    } catch (e: any) {
      await ctx.api.deleteMessage(ctx.chat!.id, waitMsg.message_id).catch(() => {});
      await ctx.reply(`❌ خطا: ${e.message}`);
    }
  };

  composer.command("today", handleToday);
  composer.hears(BTN_TODAY, handleToday);

  // ---------------- Callback: forget_code ----------------
  composer.callbackQuery(/^forget_code_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery("در حال دریافت کد تحویل...");
    const client = await getAuthenticatedClient(ctx, options);
    if (!client) return;

    const reserveId = parseInt(ctx.match[1], 10);
    try {
      const codeData = await client.getForgetCode(reserveId);
      const forgotCode = codeData.forgotCardCode;
      const foodName = (codeData.foodName || "غذا").replace(/\|+$/, "");
      const selfName = codeData.self || "سلف";
      const meal = codeData.meal || "وعده";

      if (!forgotCode) {
        await ctx.reply("❌ کد تحویل برای این غذا یافت نشد.");
        return;
      }

      // Generate QR Code in memory as PNG Uint8Array (pure Cloudflare-compatible)
      const qrBuffer = generateQrPng(forgotCode);

      const caption =
        `🎫 <b>کد تحویل / فراموشی کارت صمد</b>\n\n` +
        `🔢 <b>کد عددی:</b> <code>${forgotCode}</code>\n` +
        `🍽 <b>غذا:</b> ${foodName}\n` +
        `🥣 <b>وعده:</b> ${meal}\n` +
        `🏛 <b>سلف:</b> ${selfName}\n\n` +
        "📲 <i>این بارکد یا کد عددی را می‌توانید مستقیماً جلوی اسکنر سلف قرار دهید.</i>";

      await ctx.replyWithPhoto(new InputFile(qrBuffer, "qrcode.png"), {
        caption,
        parse_mode: "HTML",
      });
    } catch (e: any) {
      await ctx.reply(`❌ خطا در دریافت بارکد: ${e.message}`);
    }
  });

  return composer;
}
