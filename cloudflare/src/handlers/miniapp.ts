import { Composer, Context, InlineKeyboard } from "grammy";
import { BotContextOptions, getUserWebAppUrl } from "./common";

export function createMiniAppComposer(options: BotContextOptions): Composer<Context> {
  const composer = new Composer<Context>();
  const { isBale, resolvedWebAppUrl } = options;

  // ---------------- /app & /miniapp (اجرای مینی‌اپ) ----------------
  composer.command(["app", "miniapp"], async (ctx) => {
    const telegramId = ctx.from?.id;
    const userAppUrl = getUserWebAppUrl(resolvedWebAppUrl, telegramId);
    if (userAppUrl && !isBale) {
      const kb = new InlineKeyboard().webApp("🍽 باز کردن مینی‌اپ صمد", userAppUrl);
      await ctx.reply(
        "📱 <b>مینی‌اپ اتوماسیون تغذیه صمد</b>\n\n" +
          "برای مشاهده برنامه هفتگی، رزرو سریع غذا، بارکد تحویل و افزایش مستقیم اعتبار در محیط وب تلگرام، روی دکمه زیر کلیک کنید:",
        { parse_mode: "HTML", reply_markup: kb }
      );
    } else {
      await ctx.reply("⚠️ آدرس مینی‌اپ تنظیم نشده است یا پلتفرم جاری (بله) از مینی‌اپ پشتیبانی نمی‌کند.");
    }
  });

  return composer;
}
