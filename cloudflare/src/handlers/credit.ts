import { Composer, Context, InlineKeyboard } from "grammy";
import { BotContextOptions, BTN_CREDIT, BTN_CHARGE, getAuthenticatedClient } from "./common";
import { formatToman } from "../date";

export function createCreditComposer(options: BotContextOptions): Composer<Context> {
  const composer = new Composer<Context>();
  const { env } = options;

  // ---------------- /credit (مانده اعتبار) ----------------
  const handleCredit = async (ctx: Context) => {
    const client = await getAuthenticatedClient(ctx, options);
    if (!client) return;

    const waitMsg = await ctx.reply("⏳ در حال استعلام موجودی و تراکنش‌ها...");
    try {
      const profile = await client.getNurtureProfile();
      const credit = profile.credit ?? 0;
      const u = profile.user || {};
      const first = u.firstName || "";
      const last = u.lastName || "";
      const fullName = `${first} ${last}`.trim() || u.fullName || "دانشجو";
      const studentId = u.username || "";
      const changes = profile.creditChanges || [];

      await ctx.api.deleteMessage(ctx.chat!.id, waitMsg.message_id).catch(() => {});

      let text =
        "💰 <b>وضعیت اعتبار و کیف پول</b>\n\n" +
        `👤 <b>دانشجو:</b> ${fullName} (${studentId})\n` +
        `💳 <b>موجودی فعلی:</b> ${formatToman(credit)}\n` +
        "─────────────────\n";

      if (changes.length > 0) {
        text += "📜 <b>تراکنش‌ها و شارژهای اخیر:</b>\n";
        for (const item of changes.slice(0, 5)) {
          const amt = item.amount || 0;
          const sign = amt > 0 ? "+" : "";
          const desc = item.receipt?.paymentSystemName || item.description || "شارژ حساب";
          const dateStr = item.createDate || item.actionDate || "";
          text += `▫️ ${sign}${formatToman(amt)} | ${dateStr}\n   (${desc})\n`;
        }
      }

      let loginToken = "";
      try {
        loginToken = await client.getLoginToken();
      } catch {}

      const basePayUrl = env.PAY_SHARIF_URL || "https://setad.dining.sharif.edu/nurture/user/credit/charge/view.rose";
      const sep = basePayUrl.includes("?") ? "&" : "?";
      const chargeUrl = loginToken
        ? `${basePayUrl}${sep}token=${loginToken}&loginToken=${loginToken}&loginAsToken=${loginToken}`
        : basePayUrl;

      const kb = new InlineKeyboard()
        .url("💳 افزایش مستقیم اعتبار (view.rose)", chargeUrl)
        .row()
        .text("➕ سایر گزینه‌های شارژ", "recharge_credit");
      await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
    } catch (e: any) {
      await ctx.api.deleteMessage(ctx.chat!.id, waitMsg.message_id).catch(() => {});
      await ctx.reply(`❌ خطا: ${e.message}`);
    }
  };

  composer.command("credit", handleCredit);
  composer.hears(BTN_CREDIT, handleCredit);

  // ---------------- /charge (افزایش اعتبار) ----------------
  const handleCharge = async (ctx: Context) => {
    const client = await getAuthenticatedClient(ctx, options);
    if (!client) return;

    const waitMsg = await ctx.reply("⏳ در حال ایجاد لینک ورود مستقیم به صفحه افزایش اعتبار صمد...");
    try {
      let loginToken = "";
      try {
        loginToken = await client.getLoginToken();
      } catch {}
      await ctx.api.deleteMessage(ctx.chat!.id, waitMsg.message_id).catch(() => {});

      const base = (env.SAMAD_BASE_URL || "https://setad.dining.sharif.edu/").replace(/\/+$/, "");
      const directUrl = loginToken ? `${base}/#/token-login?token=${loginToken}` : base;
      const basePayUrl = env.PAY_SHARIF_URL || "https://setad.dining.sharif.edu/nurture/user/credit/charge/view.rose";
      const sep = basePayUrl.includes("?") ? "&" : "?";
      const chargeUrl = loginToken
        ? `${basePayUrl}${sep}token=${loginToken}&loginToken=${loginToken}&loginAsToken=${loginToken}`
        : basePayUrl;

      const text =
        "💳 <b>افزایش آنلاین اعتبار تغذیه صمد</b>\n\n" +
        "برای شارژ مستقیم کیف پول تغذیه دانشگاه صنعتی شریف، می‌توانید مستقیماً از طریق صفحه پرداخت صمد (view.rose) اقدام کنید.\n\n" +
        "🔹 توکن و مشخصات نشست شما در دکمه زیر تعبیه شده تا مستقیماً به صفحه پرداخت متصل به حساب خودتان هدایت شوید.\n" +
        "🔹 همچنین دکمه ورود سریع با توکن به وب صمد در دسترس است.\n" +
        "🔹 پس از اتمام پرداخت، موجودی حساب شما به‌صورت آنی در ربات به‌روزرسانی خواهد شد.";

      const kb = new InlineKeyboard()
        .url("💳 ورود مستقیم به صفحه افزایش اعتبار (view.rose)", chargeUrl)
        .row()
        .url("🔗 ورود سریع با توکن به سامانه صمد", directUrl)
        .row()
        .text("🔄 بررسی مجدد موجودی", "check_balance_now");

      await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
    } catch (e: any) {
      await ctx.api.deleteMessage(ctx.chat!.id, waitMsg.message_id).catch(() => {});
      await ctx.reply(`❌ خطا: ${e.message}`);
    }
  };

  composer.command("charge", handleCharge);
  composer.hears(BTN_CHARGE, handleCharge);

  composer.callbackQuery("recharge_credit", async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleCharge(ctx);
  });

  composer.callbackQuery("check_balance_now", async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleCredit(ctx);
  });

  return composer;
}
