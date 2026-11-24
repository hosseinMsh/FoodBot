import { Composer, Context, InlineKeyboard, InputFile } from "grammy";
import { BotContextOptions, getMainKeyboard, getUserWebAppUrl, BTN_PROFILE, getAuthenticatedClient } from "./common";
import * as db from "../db";
import * as kv from "../kv";
import { SamadClient } from "../samad";
import { formatToman } from "../date";

export function createAuthComposer(options: BotContextOptions): Composer<Context> {
  const composer = new Composer<Context>();
  const { env, isBale, resolvedWebAppUrl } = options;

  const startLoginFlow = async (ctx: Context) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    await kv.setUserSession(env.KV, telegramId, { step: "WAITING_USERNAME" }, 600);
    await ctx.reply(
      "🔐 <b>ورود به سامانه صمد</b>\n\n" +
        "لطفاً <b>شماره دانشجویی</b> (یا نام کاربری) خود را ارسال کنید:\n" +
        "(جهت انصراف /cancel را بفرستید)",
      { parse_mode: "HTML", reply_markup: { remove_keyboard: true } }
    );
  };

  // ---------------- /start ----------------
  composer.command("start", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const user = await db.getUser(env.DB, telegramId);
    if (user && user.access_token) {
      const name = user.full_name || user.username || "دانشجو";
      const selfName = user.selected_self_name || "انتخاب نشده";
      await ctx.reply(
        `سلام <b>${name}</b> عزیز! خوش آمدید 🌹\n\n` +
          `🏛 سلف فعال: <b>${selfName}</b>\n\n` +
          "از طریق دکمه‌های زیر می‌توانید سفارش‌ها، اعتبارات و برنامه‌های غذایی خود را مدیریت کنید.",
        { parse_mode: "HTML", reply_markup: getMainKeyboard() }
      );

      const userAppUrl = getUserWebAppUrl(resolvedWebAppUrl, user.telegram_id);
      if (userAppUrl && !isBale) {
        const appKb = new InlineKeyboard().webApp("📱 باز کردن مینی‌اپ صمد", userAppUrl);
        await ctx.reply("🚀 برای رزرو سریع غذا و مشاهده منو در مینی‌اپ تلگرام، کلیک کنید:", {
          reply_markup: appKb,
        });
      }
    } else {
      const msg =
        "سلام! به <b>ربات تغذیه صمد (نسخه کلودفلر)</b> خوش آمدید 🍽\n\n" +
        "برای دسترسی به غذاها، رزرو و بررسی اعتبار، ابتدا باید با حساب سامانه صمد خود وارد شوید.\n\n" +
        "هر کاربر می‌تواند با شماره دانشجویی و رمز اختصاصی خود وارد شود.\n\n" +
        "👇 جهت ورود، روی دکمه زیر کلیک کنید یا دستور /login را ارسال کنید:";
      const kb = new InlineKeyboard().text("🔐 ورود به حساب صمد", "start_login");
      const userAppUrl = getUserWebAppUrl(resolvedWebAppUrl, telegramId);
      if (userAppUrl && !isBale) {
        kb.row().webApp("📱 ورود و استفاده از مینی‌اپ", userAppUrl);
      }
      await ctx.reply(msg, { parse_mode: "HTML", reply_markup: kb });
    }
  });

  // ---------------- /login & start_login ----------------
  composer.command("login", startLoginFlow);
  composer.callbackQuery("start_login", async (ctx) => {
    await ctx.answerCallbackQuery();
    await startLoginFlow(ctx);
  });

  // ---------------- /cancel ----------------
  composer.command("cancel", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (telegramId) {
      await kv.clearUserSession(env.KV, telegramId);
    }
    await ctx.reply("عملیات لغو شد.", { reply_markup: getMainKeyboard() });
  });

  // ---------------- /logout ----------------
  composer.command("logout", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (telegramId) {
      await db.deleteUser(env.DB, telegramId);
      await kv.clearUserSession(env.KV, telegramId);
    }
    await ctx.reply("🚪 با موفقیت از حساب کاربری خارج شدید.\nجهت ورود مجدد /login را ارسال نمایید.", {
      reply_markup: { remove_keyboard: true },
    });
  });

  // ---------------- /profile & /whoami ----------------
  const handleProfile = async (ctx: Context) => {
    const client = await getAuthenticatedClient(ctx, options);
    if (!client) return;

    try {
      const telegramId = ctx.from!.id;
      const userDb = await db.getUser(env.DB, telegramId);
      const profile = await client.getUserProfile();
      const nurture = await client.getNurtureProfile();

      const first = profile.firstName || "";
      const last = profile.lastName || "";
      const fullName = (profile.fullName || `${first} ${last}`.trim()) || userDb?.full_name || "نامشخص";
      const studentId = profile.username || userDb?.username || "نامشخص";
      const credit = nurture.credit ?? 0;
      const selfName = userDb?.selected_self_name || "تعیین نشده";

      const studentInfo = profile.student || {};
      const major = studentInfo.studyMajor?.name || "نامشخص";
      const level = studentInfo.studyLevel?.name || "نامشخص";
      const autoSendEnabled = userDb?.auto_send_code !== 0;
      const autoSendStatus = autoSendEnabled
        ? "✅ فعال (ساعت ۱۱ صبح، شنبه تا چهارشنبه)"
        : "🔕 غیرفعال";

      const msg =
        "👤 <b>اطلاعات حساب کاربری</b>\n\n" +
        `▫️ <b>نام و نام خانوادگی:</b> ${fullName}\n` +
        `▫️ <b>شماره دانشجویی:</b> <code>${studentId}</code>\n` +
        `▫️ <b>مقطع و رشته:</b> ${level} - ${major}\n` +
        `▫️ <b>سلف پیش‌فرض:</b> ${selfName}\n` +
        `▫️ <b>موجودی اعتبار:</b> ${formatToman(credit)}\n` +
        `▫️ <b>ارسال خودکار کد تحویل:</b> ${autoSendStatus}\n\n` +
        "برای تغییر سلف از دکمه «⚙️ انتخاب سلف» استفاده نمایید.";

      const kb = new InlineKeyboard().text(
        autoSendEnabled ? "🔕 غیرفعال کردن ارسال خودکار ساعت ۱۱" : "🔔 فعال کردن ارسال خودکار ساعت ۱۱",
        "toggle_autocode"
      );

      await ctx.reply(msg, { parse_mode: "HTML", reply_markup: kb });
    } catch (e: any) {
      await ctx.reply(`❌ خطا در دریافت اطلاعات: ${e.message}`);
    }
  };

  composer.command(["profile", "whoami"], handleProfile);
  composer.hears(BTN_PROFILE, handleProfile);

  // ---------------- Text listener for Login State Machine ----------------
  composer.on("message:text", async (ctx, next) => {
    const text = ctx.message.text.trim();
    const telegramId = ctx.from?.id;
    if (!telegramId) return next();

    // Check if user is in an active login session
    const session = await kv.getUserSession(env.KV, telegramId);
    if (!session || !session.step) {
      return next();
    }

    if (session.step === "WAITING_FAVORITE_NAME") {
      const foodName = text;
      await db.addFavoriteFood(env.DB, telegramId, foodName);
      await kv.clearUserSession(env.KV, telegramId);

      const kb = new InlineKeyboard()
        .text("➕ افزودن غذای دیگر", "fav_add_manual")
        .row()
        .text("⭐️ مشاهده لیست غذاهای موردعلاقه", "fav_back_list")
        .row()
        .text("🤖 تنظیمات رزرو خودکار", "open_autoreserve_panel");

      await ctx.reply(
        `✅ غذای «<b>${foodName}</b>» با موفقیت به لیست علاقه‌مندی‌های شما اضافه شد!`,
        { parse_mode: "HTML", reply_markup: kb }
      );
      return;
    }

    if (session.step === "WAITING_USERNAME") {
      session.tempUsername = text;
      session.step = "WAITING_PASSWORD";
      await kv.setUserSession(env.KV, telegramId, session, 600);

      await ctx.reply(
        `شماره دانشجویی: <code>${text}</code>\n\n` +
          "حالا لطفاً <b>رمز عبور</b> سامانه صمد را ارسال کنید:\n" +
          "<i>(پیام حاوی رمز شما بلافاصله از چت حذف خواهد شد)</i>",
        { parse_mode: "HTML" }
      );
      return;
    }

    if (session.step === "WAITING_PASSWORD") {
      const password = text;

      // Immediately delete user's password message for privacy
      await ctx.deleteMessage().catch(() => {});

      const waitMsg = await ctx.reply("⏳ در حال دریافت کد امنیتی (کپچا)...");

      const client = new SamadClient(env);
      try {
        const captchaData = await client.getCaptcha();
        session.tempPassword = password;
        session.captchaNonce = captchaData.nonce;
        session.captchaValidation = captchaData.validation;
        session.step = "WAITING_CAPTCHA";
        await kv.setUserSession(env.KV, telegramId, session, 600);

        await ctx.api.deleteMessage(ctx.chat!.id, waitMsg.message_id).catch(() => {});

        // Send captcha image
        const imgBuffer = Uint8Array.from(atob(captchaData.imageBase64), (c) => c.charCodeAt(0));
        await ctx.replyWithPhoto(new InputFile(imgBuffer, "captcha.png"), {
          caption: "🔢 لطفاً <b>کد امنیتی</b> تصویر بالا را ارسال کنید:\n<i>(حروف یا اعداد انگلیسی)</i>",
          parse_mode: "HTML",
        });
      } catch (e: any) {
        await ctx.api.deleteMessage(ctx.chat!.id, waitMsg.message_id).catch(() => {});
        await ctx.reply(`❌ خطا در ارتباط با صمد: ${e.message}\nلطفاً مجدداً /login را بزنید.`);
        await kv.clearUserSession(env.KV, telegramId);
      }
      return;
    }

    if (session.step === "WAITING_CAPTCHA") {
      const captchaText = text;
      const username = session.tempUsername || "";
      const password = session.tempPassword || "";
      const nonce = session.captchaNonce || "";
      const validation = session.captchaValidation || "";

      const waitMsg = await ctx.reply("⏳ در حال بررسی اطلاعات و ورود به سامانه صمد...");

      const client = new SamadClient(env, {
        telegram_id: telegramId,
        username,
        access_token: "",
        refresh_token: "",
        token_expires_at: 0,
      });

      try {
        await client.login(username, password, captchaText, validation, nonce);

        // Fetch profile
        let fullName = "";
        try {
          const profile = await client.getUserProfile();
          const first = profile.firstName || "";
          const last = profile.lastName || "";
          fullName = (profile.fullName || `${first} ${last}`.trim()) || username;
          if (fullName) {
            await db.updateUserProfile(env.DB, telegramId, fullName);
          }
        } catch {}

        // Fetch selfs and set default
        try {
          const selfs = await client.getAvailableSelfs();
          if (selfs.length > 0) {
            let target = selfs[0];
            for (const s of selfs) {
              if (s.name && s.name.includes("مرکزی")) {
                target = s;
                break;
              }
            }
            await db.updateSelectedSelf(env.DB, telegramId, target.id, target.name);
          }
        } catch {}

        await kv.clearUserSession(env.KV, telegramId);
        await ctx.api.deleteMessage(ctx.chat!.id, waitMsg.message_id).catch(() => {});

        await ctx.reply(
          `✅ <b>ورود موفقیت‌آمیز بود!</b>\n\n` +
            `👤 کاربر: <b>${fullName || username}</b>\n` +
            "اکنون به کلیه امکانات ربات دسترسی دارید.",
          { parse_mode: "HTML", reply_markup: getMainKeyboard() }
        );
      } catch (e: any) {
        // If captcha failed or was invalid, generate fresh captcha to retry
        try {
          const freshCaptcha = await client.getCaptcha();
          session.captchaNonce = freshCaptcha.nonce;
          session.captchaValidation = freshCaptcha.validation;
          await kv.setUserSession(env.KV, telegramId, session, 600);

          await ctx.api.deleteMessage(ctx.chat!.id, waitMsg.message_id).catch(() => {});
          const imgBuffer = Uint8Array.from(atob(freshCaptcha.imageBase64), (c) => c.charCodeAt(0));
          await ctx.replyWithPhoto(new InputFile(imgBuffer, "captcha.png"), {
            caption: `❌ <b>خطا:</b> ${e.message}\n\n🔢 لطفاً <b>کد امنیتی جدید</b> بالا را مجدداً ارسال کنید:`,
            parse_mode: "HTML",
          });
        } catch {
          await kv.clearUserSession(env.KV, telegramId);
          await ctx.api.deleteMessage(ctx.chat!.id, waitMsg.message_id).catch(() => {});
          await ctx.reply(`❌ <b>خطا در ورود:</b>\n${e.message}\n\nجهت تلاش مجدد دستور /login را ارسال کنید.`, {
            parse_mode: "HTML",
            reply_markup: getMainKeyboard(),
          });
        }
      }
      return;
    }

    return next();
  });

  return composer;
}
