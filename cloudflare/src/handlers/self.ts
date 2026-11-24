import { Composer, Context, InlineKeyboard } from "grammy";
import { BotContextOptions, BTN_SELF, getAuthenticatedClient } from "./common";
import * as db from "../db";

export function createSelfComposer(options: BotContextOptions): Composer<Context> {
  const composer = new Composer<Context>();
  const { env } = options;

  // ---------------- /self (انتخاب سلف پیش‌فرض) ----------------
  const handleSelectSelf = async (ctx: Context) => {
    const client = await getAuthenticatedClient(ctx, options);
    if (!client) return;

    const waitMsg = await ctx.reply("⏳ در حال دریافت لیست سلف‌ها...");
    try {
      const selfs = await client.getAvailableSelfs();
      await ctx.api.deleteMessage(ctx.chat!.id, waitMsg.message_id).catch(() => {});

      const telegramId = ctx.from!.id;
      const userDb = await db.getUser(env.DB, telegramId);
      const curId = userDb?.selected_self_id;

      const kb = new InlineKeyboard();
      for (const s of selfs) {
        const active = s.id === curId ? "✅ " : "";
        kb.text(`${active}${s.name}`, `set_self_${s.id}`).row();
      }

      await ctx.reply("🏛 <b>انتخاب سالن غذاخوری (سلف)</b>\n\nلطفاً سلف پیش‌فرض خود را انتخاب کنید:", {
        parse_mode: "HTML",
        reply_markup: kb,
      });
    } catch (e: any) {
      await ctx.api.deleteMessage(ctx.chat!.id, waitMsg.message_id).catch(() => {});
      await ctx.reply(`❌ خطا: ${e.message}`);
    }
  };

  composer.command("self", handleSelectSelf);
  composer.hears(BTN_SELF, handleSelectSelf);

  composer.callbackQuery(/^set_self_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const selfId = parseInt(ctx.match[1], 10);
    const telegramId = ctx.from!.id;

    const client = await getAuthenticatedClient(ctx, options);
    let selfName = "سلف";
    if (client) {
      try {
        const selfs = await client.getAvailableSelfs();
        const found = selfs.find((s) => s.id === selfId);
        if (found) selfName = found.name;
      } catch {}
    }

    await db.updateSelectedSelf(env.DB, telegramId, selfId, selfName);
    await ctx.reply(`✅ سلف پیش‌فرض شما با موفقیت به <b>${selfName}</b> تغییر یافت.`, {
      parse_mode: "HTML",
    });
  });

  return composer;
}
