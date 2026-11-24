import { Composer, Context, InlineKeyboard } from "grammy";
import { BotContextOptions, BTN_REMAINING, getAuthenticatedClient } from "./common";
import { getCurrentWeekSaturdayStr, formatToman } from "../date";

export function createRemainingComposer(options: BotContextOptions): Composer<Context> {
  const composer = new Composer<Context>();

  // ---------------- /remaining ----------------
  const handleRemaining = async (ctx: Context) => {
    const client = await getAuthenticatedClient(ctx, options);
    if (!client) return;

    const waitMsg = await ctx.reply("⏳ در حال استعلام غذاهای رزرو شده هفته جاری...");
    try {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, "0");
      const d = String(now.getDate()).padStart(2, "0");
      const todayStr = `${y}-${m}-${d}`;

      const curSat = getCurrentWeekSaturdayStr(now);
      const data = await client.getReservationInfo(curSat);
      const remainCredit = data.remainCredit;
      const weekDays = data.weekDays || [];

      const remainingReserves: any[] = [];
      for (const day of weekDays) {
        const isUpcoming = (day.date || "") >= todayStr;
        for (const mt of day.mealTypes || []) {
          const mTitle = mt.name || mt.mealTypeTitle || "ناهار";
          const resList = [];
          if (mt.reserve && typeof mt.reserve === "object") resList.push(mt.reserve);
          if (Array.isArray(mt.reserves)) resList.push(...mt.reserves);

          for (const r of resList) {
            const consumed = !!r.consumed;
            const timeDist = r.timeDistanceUntilToday ?? 0;
            if (isUpcoming || timeDist >= 0 || !consumed) {
              remainingReserves.push({
                dayName: day.dayTranslated,
                dateJStr: day.dateJStr,
                mealTitle: mTitle,
                mealTypeId: mt.mealTypeId || 1,
                reserve: r,
              });
            }
          }
        }
      }

      await ctx.api.deleteMessage(ctx.chat!.id, waitMsg.message_id).catch(() => {});

      if (remainingReserves.length === 0) {
        await ctx.reply(
          "📋 <b>غذاهای رزرو مانده هفته جاری</b>\n\n" +
            "ℹ️ شما در ادامه هفته جاری هیچ وعده غذایی رزرو شده‌ای ندارید.\n\n" +
            "جهت رزرو غذاهای هفته بعد می‌توانید از گزینه «📅 لیست غذاهای هفته بعدی» استفاده کنید.",
          { parse_mode: "HTML" }
        );
        return;
      }

      let text =
        "📋 <b>لیست غذاهای رزرو شده باقی‌مانده این هفته:</b>\n" +
        `💰 موجودی باقی‌مانده: ${formatToman(remainCredit)}\n` +
        "─────────────────\n";

      const kb = new InlineKeyboard();
      for (const item of remainingReserves) {
        const r = item.reserve;
        const resId = r.id;
        const progId = r.programId;
        const foodTypeId = r.foodTypeId || 101;
        const foodName = r.foodNames || r.foodName || "غذا";
        const selfName = r.selfName || r.self || "سلف";
        const consumed = !!r.consumed;
        const statusStr = consumed ? "✅ دریافت شده" : "⏳ در انتظار تحویل";

        text +=
          `\n🗓 <b>${item.dayName} (${item.dateJStr})</b> - <b>${item.mealTitle}</b>\n` +
          `🍱 ${foodName}\n` +
          `🏛 ${selfName} | ${formatToman(r.price)}\n` +
          `📌 ${statusStr}\n`;

        if (!consumed && resId) {
          kb.text(`📱 کد ${item.dayName}`, `forget_code_${resId}`);
          if (progId) {
            kb.text(`❌ لغو`, `cancel_meal_${progId}_${foodTypeId}_${item.mealTypeId}`);
          }
          kb.row();
        }
      }

      await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
    } catch (e: any) {
      await ctx.api.deleteMessage(ctx.chat!.id, waitMsg.message_id).catch(() => {});
      await ctx.reply(`❌ خطا: ${e.message}`);
    }
  };

  composer.command("remaining", handleRemaining);
  composer.hears(BTN_REMAINING, handleRemaining);

  composer.callbackQuery(/^cancel_meal_(\d+)_(\d+)_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const client = await getAuthenticatedClient(ctx, options);
    if (!client) return;

    const progId = parseInt(ctx.match[1], 10);
    const foodTypeId = parseInt(ctx.match[2], 10);
    const mealTypeId = parseInt(ctx.match[3], 10);

    try {
      const msg = await client.setFoodReservation(progId, foodTypeId, mealTypeId, false);
      await ctx.reply(`✅ ${msg}`);
    } catch (e: any) {
      await ctx.reply(`❌ خطا در لغو غذا: ${e.message}`);
    }
  });

  return composer;
}
