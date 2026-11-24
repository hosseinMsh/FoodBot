import { Composer, Context, InlineKeyboard } from "grammy";
import { BotContextOptions, BTN_FAVORITES, getAuthenticatedClient } from "./common";
import * as db from "../db";
import * as kv from "../kv";
import { Env } from "../types";

export const POPULAR_FOOD_SUGGESTIONS = [
  "چلو کباب کوبیده",
  "چلو جوجه کباب",
  "زرشک پلو با مرغ",
  "چلو خورش قورمه سبزی",
  "چلو خورش قیمه",
  "شنسل مرغ",
  "پیتزا",
  "چلو گوشت",
  "ماکارونی",
];

export async function renderFavoritesPanel(telegramId: number, env: Env) {
  const list = await db.getFavoriteFoods(env.DB, telegramId);
  let text =
    `⭐️ <b>لیست غذاهای موردعلاقه من</b>\n\n` +
    `این لیست برای <b>رزرو خودکار هوشمند غذا</b> استفاده می‌شود. ` +
    `هر زمان این غذاها در منوی سلف شما باز شوند، ربات به‌صورت خودکار آن‌ها را برای روزهای باقی‌مانده هفته و روزهای پیش‌رو رزرو خواهد کرد.\n\n`;

  const kb = new InlineKeyboard();

  if (list.length === 0) {
    text +=
      `<i>شما هنوز هیچ غذای موردعلاقه‌ای اضافه نکرده‌اید!</i>\n\n` +
      `برای شروع، می‌توانید نام غذای محبوب خود (مثلاً کباب، جوجه، پیتزا) را تایپ کنید یا از دکمه‌های پیشنهادی زیر استفاده نمایید:\n`;
  } else {
    text += `📋 <b>غذاهای ثبت‌شده در علاقه‌مندی‌ها (${list.length} مورد):</b>\n`;
    list.forEach((food, idx) => {
      text += `▫️ ${idx + 1}. <b>${food}</b>\n`;
      kb.text(`❌ حذف ${food}`, `fav_del_${encodeURIComponent(food)}`).row();
    });
    text += `\n─────────────────\n`;
  }

  kb.text("➕ نوشتن نام غذای دلخواه", "fav_add_manual").row();
  kb.text("💡 انتخاب از غذاهای محبوب دانشگاه", "fav_show_suggestions").row();
  kb.text("🤖 تنظیمات رزرو خودکار", "open_autoreserve_panel");

  return { text, kb };
}

export function createFavoritesComposer(options: BotContextOptions): Composer<Context> {
  const composer = new Composer<Context>();
  const { env } = options;

  // ---------------- /favorites & BTN_FAVORITES ----------------
  const handleFavorites = async (ctx: Context) => {
    const client = await getAuthenticatedClient(ctx, options);
    if (!client) return;

    const telegramId = ctx.from!.id;
    const { text, kb } = await renderFavoritesPanel(telegramId, env);
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
  };

  composer.command("favorites", handleFavorites);
  composer.hears(BTN_FAVORITES, handleFavorites);

  // ---------------- Delete Favorite ----------------
  composer.callbackQuery(/^fav_del_(.+)$/, async (ctx) => {
    const rawFood = decodeURIComponent(ctx.match[1]);
    const telegramId = ctx.from!.id;
    await db.removeFavoriteFood(env.DB, telegramId, rawFood);
    await ctx.answerCallbackQuery(`❌ «${rawFood}» از لیست علاقه‌مندی‌ها حذف شد.`);

    const { text, kb } = await renderFavoritesPanel(telegramId, env);
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb }).catch(async () => {
      await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
    });
  });

  // ---------------- Show Suggestions ----------------
  composer.callbackQuery("fav_show_suggestions", async (ctx) => {
    await ctx.answerCallbackQuery();
    const telegramId = ctx.from!.id;
    const currentList = await db.getFavoriteFoods(env.DB, telegramId);

    let text =
      `💡 <b>پیشنهاد از غذاهای محبوب دانشگاهی</b>\n\n` +
      `برای افزودن سریع هر یک از غذاها به لیست علاقه‌مندی‌های خود، روی آن کلیک کنید:\n`;

    const kb = new InlineKeyboard();
    for (const food of POPULAR_FOOD_SUGGESTIONS) {
      const alreadyAdded = currentList.includes(food);
      if (alreadyAdded) {
        kb.text(`✅ ${food} (موجود)`, "noop").row();
      } else {
        kb.text(`➕ ${food}`, `fav_add_sug_${encodeURIComponent(food)}`).row();
      }
    }
    kb.text("🔙 بازگشت به لیست علاقه‌مندی‌ها", "fav_back_list");

    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb }).catch(async () => {
      await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
    });
  });

  // ---------------- Add Suggested Food ----------------
  composer.callbackQuery(/^fav_add_sug_(.+)$/, async (ctx) => {
    const rawFood = decodeURIComponent(ctx.match[1]);
    const telegramId = ctx.from!.id;
    await db.addFavoriteFood(env.DB, telegramId, rawFood);
    await ctx.answerCallbackQuery(`✅ «${rawFood}» به علاقه‌مندی‌ها اضافه شد!`);

    const { text, kb } = await renderFavoritesPanel(telegramId, env);
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb }).catch(async () => {
      await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
    });
  });

  // ---------------- Manual Food Adding ----------------
  composer.callbackQuery("fav_add_manual", async (ctx) => {
    await ctx.answerCallbackQuery();
    const telegramId = ctx.from!.id;

    await kv.setUserSession(env.KV, telegramId, { step: "WAITING_FAVORITE_NAME" }, 300);

    const text =
      `✍️ <b>افزودن غذای موردعلاقه</b>\n\n` +
      `لطفاً نام یا کلمه کلیدی غذای موردنظر خود را ارسال کنید:\n` +
      `<i>(مثال: جوجه کباب، قورمه سبزی، پیتزا، زرشک پلو)</i>\n\n` +
      `ℹ️ برای انصراف دستور /cancel را ارسال کنید.`;

    const kb = new InlineKeyboard().text("🔙 بازگشت و انصراف", "fav_back_list");
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
  });

  // ---------------- Back to List ----------------
  composer.callbackQuery("fav_back_list", async (ctx) => {
    await ctx.answerCallbackQuery();
    const telegramId = ctx.from!.id;
    await kv.clearUserSession(env.KV, telegramId);

    const { text, kb } = await renderFavoritesPanel(telegramId, env);
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb }).catch(async () => {
      await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
    });
  });

  // ---------------- Noop ----------------
  composer.callbackQuery("noop", async (ctx) => {
    await ctx.answerCallbackQuery("این غذا قبلاً به لیست شما اضافه شده است.");
  });

  return composer;
}
