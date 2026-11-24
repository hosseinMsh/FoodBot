import { Composer, Context, InlineKeyboard } from "grammy";
import { BotContextOptions, BTN_AUTORESERVE, getAuthenticatedClient } from "./common";
import * as db from "../db";
import { runAutoReserveEngine } from "../scheduler";
import { renderFavoritesPanel } from "./favorites";
import { Env } from "../types";
import { formatToman } from "../date";

export async function renderAutoReservePanel(telegramId: number, env: Env) {
  const user = await db.getUser(env.DB, telegramId);
  const favorites = await db.getFavoriteFoods(env.DB, telegramId);
  const isEnabled = user?.auto_reserve_enabled === 1;

  const statusText = isEnabled
    ? "✅ <b>روشن و فعال</b>"
    : "🔕 <b>خاموش و غیرفعال</b>";

  const selfName = user?.selected_self_name || "تعیین نشده";
  const favCount = favorites.length;

  let text =
    `🤖 <b>سامانه رزرو خودکار هوشمند غذا</b>\n\n` +
    `وضعیت فعلی: ${statusText}\n` +
    `🏛 سلف پیش‌فرض: <b>${selfName}</b>\n` +
    `⭐️ غذاهای موردعلاقه ثبت‌شده: <b>${favCount} غذا</b>\n` +
    `📅 محدوده رزرو: <b>کلیه روزهای باز (مانده هفته و هفته آینده)</b>\n\n` +
    `💡 <i>نحوه کارکرد:</i>\n` +
    `موتور رزرو خودکار هر شب (به‌ویژه شب‌های دوشنبه، سه‌شنبه و چهارشنبه ساعت ۲۱:۳۰) منوی روزهای باز سلف شما را بررسی کرده و در صورت موجود بودن غذای محبوب و عدم رزرو قبلی، آن را به‌طور خودکار برای شما رزرو می‌نماید.\n\n` +
    `همچنین هر زمان بخواهید می‌توانید با دکمه زیر، رزرو خودکار را در همان لحظه اجرا کنید:`;

  const kb = new InlineKeyboard()
    .text(isEnabled ? "🔕 غیرفعال کردن رزرو خودکار" : "🔔 فعال کردن رزرو خودکار", "toggle_autoreserve")
    .row()
    .text("⚡️ بررسی و رزرو خودکار همین حالا", "run_autoreserve_now")
    .row()
    .text("⭐️ مدیریت لیست غذاهای موردعلاقه", "open_favorites_panel")
    .row()
    .text("💰 استعلام موجودی کیف پول", "check_balance_now");

  return { text, kb };
}

export function createAutoReserveComposer(options: BotContextOptions): Composer<Context> {
  const composer = new Composer<Context>();
  const { env } = options;

  // ---------------- /autoreserve & BTN_AUTORESERVE ----------------
  const handleAutoReserve = async (ctx: Context) => {
    const client = await getAuthenticatedClient(ctx, options);
    if (!client) return;

    const telegramId = ctx.from!.id;
    const { text, kb } = await renderAutoReservePanel(telegramId, env);
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
  };

  composer.command(["autoreserve", "smartreserve"], handleAutoReserve);
  composer.hears(BTN_AUTORESERVE, handleAutoReserve);

  composer.callbackQuery("open_autoreserve_panel", async (ctx) => {
    await ctx.answerCallbackQuery();
    const telegramId = ctx.from!.id;
    const { text, kb } = await renderAutoReservePanel(telegramId, env);
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb }).catch(async () => {
      await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
    });
  });

  composer.callbackQuery("open_favorites_panel", async (ctx) => {
    await ctx.answerCallbackQuery();
    const telegramId = ctx.from!.id;
    const { text, kb } = await renderFavoritesPanel(telegramId, env);
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb }).catch(async () => {
      await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
    });
  });

  // ---------------- Toggle Auto-Reserve ----------------
  composer.callbackQuery("toggle_autoreserve", async (ctx) => {
    const telegramId = ctx.from!.id;
    const user = await db.getUser(env.DB, telegramId);
    if (!user) {
      await ctx.answerCallbackQuery("ابتدا وارد حساب کاربری شوید.");
      return;
    }

    const newState = user.auto_reserve_enabled !== 1;
    await db.setAutoReserveSettings(env.DB, telegramId, newState, "ALL", "MON,TUE,WED");
    await ctx.answerCallbackQuery(
      newState ? "✅ رزرو خودکار هوشمند فعال شد." : "🔕 رزرو خودکار هوشمند غیرفعال شد."
    );

    const { text, kb } = await renderAutoReservePanel(telegramId, env);
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb }).catch(async () => {
      await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
    });
  });

  // ---------------- Run Auto-Reserve On Demand ----------------
  composer.callbackQuery("run_autoreserve_now", async (ctx) => {
    await ctx.answerCallbackQuery("در حال بررسی منو و رزرو خودکار...");
    const client = await getAuthenticatedClient(ctx, options);
    if (!client) return;

    const telegramId = ctx.from!.id;
    const waitMsg = await ctx.reply("⏳ در حال استعلام منوی سلف و تطبیق با لیست غذاهای موردعلاقه شما...");

    try {
      const summary = await runAutoReserveEngine(env, { targetUserId: telegramId });
      await ctx.api.deleteMessage(ctx.chat!.id, waitMsg.message_id).catch(() => {});

      const userSummary = summary.summaries.find((s) => s.telegramId === telegramId);
      const reservedCount = userSummary?.reservedMeals.length || 0;
      const lowCreditCount = userSummary?.lowCreditAlerts.length || 0;

      if (reservedCount === 0 && lowCreditCount === 0) {
        const favs = await db.getFavoriteFoods(env.DB, telegramId);
        if (favs.length === 0) {
          await ctx.reply(
            "ℹ️ <b>لیست علاقه‌مندی‌های شما خالی است!</b>\n\n" +
              "جهت استفاده از رزرو خودکار، ابتدا باید حداقل یک غذای محبوب اضافه کنید.",
            {
              parse_mode: "HTML",
              reply_markup: new InlineKeyboard().text("⭐️ افزودن غذای موردعلاقه", "open_favorites_panel"),
            }
          );
        } else {
          await ctx.reply(
            "ℹ️ <b>بررسی منو انجام شد</b>\n\n" +
              "در حال حاضر تمامی روزهای باز قبلاً رزرو شده‌اند یا غذای جدیدی مطابق با لیست علاقه‌مندی‌های شما یافت نشد.",
            { parse_mode: "HTML" }
          );
        }
      }
    } catch (e: any) {
      await ctx.api.deleteMessage(ctx.chat!.id, waitMsg.message_id).catch(() => {});
      await ctx.reply(`❌ خطا در اجرای رزرو خودکار: ${e.message}`);
    }
  });

  return composer;
}
