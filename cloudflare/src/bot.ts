import { Bot, Context, InlineKeyboard, Keyboard, InputFile } from "grammy";
import { generateQrPng } from "./qr";
import { Env, User } from "./types";
import * as db from "./db";
import * as kv from "./kv";
import { SamadClient, SamadError } from "./samad";
import {
  getCurrentWeekSaturdayStr,
  getNextWeekSaturdayStr,
  formatToman,
  normalizeWeeklyPrograms,
  toJalaliStr,
  toPersianDayName,
} from "./date";

// Main persistent keyboard buttons
const BTN_TODAY = "🍽 دریافت غذای روز";
const BTN_REMAINING = "📋 غذاهای رزرو مانده هفته";
const BTN_NEXT_WEEK = "📅 لیست غذاهای هفته بعدی";
const BTN_BUY = "🛒 خرید و رزرو غذا";
const BTN_CREDIT = "💰 مانده اعتبار";
const BTN_CHARGE = "💳 افزایش اعتبار";
const BTN_SELF = "⚙️ انتخاب سلف";
const BTN_PROFILE = "👤 حساب کاربری";

export function getMainKeyboard(): Keyboard {
  return new Keyboard()
    .text(BTN_TODAY)
    .text(BTN_REMAINING)
    .row()
    .text(BTN_NEXT_WEEK)
    .text(BTN_BUY)
    .row()
    .text(BTN_CREDIT)
    .text(BTN_CHARGE)
    .row()
    .text(BTN_SELF)
    .text(BTN_PROFILE)
    .resized();
}

export function createBot(env: Env, customApiRoot?: string): Bot {
  const isBale = env.PLATFORM?.toLowerCase() === "bale";
  const apiRoot =
    customApiRoot ||
    env.BOT_API_ROOT ||
    (isBale ? "https://tapi.bale.ai" : "https://api.telegram.org");

  const bot = new Bot(env.BOT_TOKEN, {
    client: {
      apiRoot,
    },
  });

  // Helper to ensure authentication
  async function getClient(ctx: Context): Promise<SamadClient | null> {
    const telegramId = ctx.from?.id;
    if (!telegramId) return null;

    const client = await SamadClient.forUser(env, telegramId);
    if (!client) {
      const msg =
        "⚠️ <b>شما هنوز وارد حساب سامانه صمد خود نشده‌اید.</b>\n\n" +
        "برای اتصال به سامانه صمد، روی دکمه زیر کلیک کنید یا دستور /login را ارسال نمایید:";
      const kb = new InlineKeyboard().text("🔐 ورود به حساب صمد", "start_login");
      await ctx.reply(msg, { parse_mode: "HTML", reply_markup: kb });
      return null;
    }
    return client;
  }

  // ---------------- /start ----------------
  bot.command("start", async (ctx) => {
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
    } else {
      const msg =
        "سلام! به <b>ربات تغذیه صمد (نسخه کلودفلر)</b> خوش آمدید 🍽\n\n" +
        "برای دسترسی به غذاها، رزرو و بررسی اعتبار، ابتدا باید با حساب سامانه صمد خود وارد شوید.\n\n" +
        "هر کاربر می‌تواند با شماره دانشجویی و رمز اختصاصی خود وارد شود.\n\n" +
        "👇 جهت ورود، روی دکمه زیر کلیک کنید یا دستور /login را ارسال کنید:";
      const kb = new InlineKeyboard().text("🔐 ورود به حساب صمد", "start_login");
      await ctx.reply(msg, { parse_mode: "HTML", reply_markup: kb });
    }
  });

  // ---------------- /login ----------------
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

  bot.command("login", startLoginFlow);
  bot.callbackQuery("start_login", async (ctx) => {
    await ctx.answerCallbackQuery();
    await startLoginFlow(ctx);
  });

  bot.command("cancel", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (telegramId) {
      await kv.clearUserSession(env.KV, telegramId);
    }
    await ctx.reply("عملیات لغو شد.", { reply_markup: getMainKeyboard() });
  });

  // ---------------- /logout ----------------
  bot.command("logout", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (telegramId) {
      await db.deleteUser(env.DB, telegramId);
      await kv.clearUserSession(env.KV, telegramId);
    }
    await ctx.reply("🚪 با موفقیت از حساب کاربری خارج شدید.\nجهت ورود مجدد /login را ارسال نمایید.", {
      reply_markup: { remove_keyboard: true },
    });
  });

  // ---------------- /profile ----------------
  const handleProfile = async (ctx: Context) => {
    const client = await getClient(ctx);
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

      const msg =
        "👤 <b>اطلاعات حساب کاربری</b>\n\n" +
        `▫️ <b>نام و نام خانوادگی:</b> ${fullName}\n` +
        `▫️ <b>شماره دانشجویی:</b> <code>${studentId}</code>\n` +
        `▫️ <b>مقطع و رشته:</b> ${level} - ${major}\n` +
        `▫️ <b>سلف پیش‌فرض:</b> ${selfName}\n` +
        `▫️ <b>موجودی اعتبار:</b> ${formatToman(credit)}\n\n` +
        "برای تغییر سلف از دکمه «⚙️ انتخاب سلف» استفاده نمایید.";

      await ctx.reply(msg, { parse_mode: "HTML" });
    } catch (e: any) {
      await ctx.reply(`❌ خطا در دریافت اطلاعات: ${e.message}`);
    }
  };

  bot.command("profile", handleProfile);
  bot.command("whoami", handleProfile);
  bot.hears(BTN_PROFILE, handleProfile);

  // ---------------- /today (غذای امروز) ----------------
  const handleToday = async (ctx: Context) => {
    const client = await getClient(ctx);
    if (!client) return;

    const waitMsg = await ctx.reply("⏳ در حال دریافت اطلاعات غذای امروز...");
    try {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, "0");
      const d = String(now.getDate()).padStart(2, "0");
      const todayStr = `${y}-${m}-${d}`;
      const todayJalali = toJalaliStr(now);

      const curSat = getCurrentWeekSaturdayStr(now);
      const data = await client.getReservationInfo(curSat);
      const weekDays = data.weekDays || [];

      const todayMeals: { mealTitle: string; res: any }[] = [];
      let todayDayName = "";

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

  bot.command("today", handleToday);
  bot.hears(BTN_TODAY, handleToday);

  // ---------------- Callback: forget_code ----------------
  bot.callbackQuery(/^forget_code_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery("در حال دریافت کد تحویل...");
    const client = await getClient(ctx);
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

      // Generate QR Code in memory as PNG Uint8Array (zero external Canvas/Node dependencies)
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

  // ---------------- /nextweek (برنامه هفته بعد) ----------------
  const handleNextWeek = async (ctx: Context) => {
    const client = await getClient(ctx);
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

  bot.command("nextweek", handleNextWeek);
  bot.hears(BTN_NEXT_WEEK, handleNextWeek);

  // ---------------- همه سلف‌ها (مقایسه روز به روز) ----------------
  bot.callbackQuery("all_selfs_overview", async (ctx) => {
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

  bot.callbackQuery(/^all_selfs_day_(\d+)$/, async (ctx) => {
    const dayIdx = parseInt(ctx.match[1], 10);
    await ctx.answerCallbackQuery("در حال دریافت منوی همه سلف‌ها...");
    const client = await getClient(ctx);
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
  bot.callbackQuery("browse_all_selfs", async (ctx) => {
    await ctx.answerCallbackQuery();
    const client = await getClient(ctx);
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

  bot.callbackQuery(/^view_self_menu_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const selfId = parseInt(ctx.match[1], 10);

    const client = await getClient(ctx);
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

  // ---------------- /remaining (غذاهای مانده هفته) ----------------
  const handleRemaining = async (ctx: Context) => {
    const client = await getClient(ctx);
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

  bot.command("remaining", handleRemaining);
  bot.hears(BTN_REMAINING, handleRemaining);

  bot.callbackQuery(/^cancel_meal_(\d+)_(\d+)_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const client = await getClient(ctx);
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

  // ---------------- /credit (مانده اعتبار) ----------------
  const handleCredit = async (ctx: Context) => {
    const client = await getClient(ctx);
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

      const kb = new InlineKeyboard().text("💳 افزایش آنلاین اعتبار", "recharge_credit");
      await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
    } catch (e: any) {
      await ctx.api.deleteMessage(ctx.chat!.id, waitMsg.message_id).catch(() => {});
      await ctx.reply(`❌ خطا: ${e.message}`);
    }
  };

  bot.command("credit", handleCredit);
  bot.hears(BTN_CREDIT, handleCredit);

  // ---------------- /charge (افزایش اعتبار) ----------------
  const handleCharge = async (ctx: Context) => {
    const client = await getClient(ctx);
    if (!client) return;

    const waitMsg = await ctx.reply("⏳ در حال ایجاد لینک ورود مستقیم به درگاه پرداخت صمد...");
    try {
      const loginToken = await client.getLoginToken();
      await ctx.api.deleteMessage(ctx.chat!.id, waitMsg.message_id).catch(() => {});

      const base = (env.SAMAD_BASE_URL || "https://setad.dining.sharif.edu/").replace(/\/+$/, "");
      const directUrl = loginToken ? `${base}/#/token-login?token=${loginToken}` : base;

      const text =
        "💳 <b>افزایش آنلاین اعتبار تغذیه</b>\n\n" +
        "برای شارژ حساب و اتصال به درگاه بانکی شتاب، می‌توانید از طریق دکمه زیر بدون نیاز به ورود مجدد رمز، مستقیماً به صفحه شارژ سامانه صمد منتقل شوید.\n\n" +
        "🔹 پس از اتمام پرداخت، موجودی شما بلافاصله به‌روزرسانی خواهد شد.";

      const kb = new InlineKeyboard()
        .url("🔗 ورود مستقیم به درگاه پرداخت صمد", directUrl)
        .row()
        .text("🔄 بررسی مجدد موجودی", "check_balance_now");

      await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
    } catch (e: any) {
      await ctx.api.deleteMessage(ctx.chat!.id, waitMsg.message_id).catch(() => {});
      await ctx.reply(`❌ خطا: ${e.message}`);
    }
  };

  bot.command("charge", handleCharge);
  bot.hears(BTN_CHARGE, handleCharge);
  bot.callbackQuery("recharge_credit", async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleCharge(ctx);
  });
  bot.callbackQuery("check_balance_now", async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleCredit(ctx);
  });

  // ---------------- /buy (خرید و رزرو غذا) ----------------
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

  bot.command("buy", handleBuy);
  bot.hears(BTN_BUY, handleBuy);

  bot.callbackQuery(/^start_weekly_reserve|buy_weekly_start$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const client = await getClient(ctx);
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

  bot.callbackQuery(/^buy_view_day_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const dayIdx = parseInt(ctx.match[1], 10);
    const client = await getClient(ctx);
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

  bot.callbackQuery(/^do_reserve_(\d+)_(\d+)_(\d+)_(\d+)$/, async (ctx) => {
    const progId = parseInt(ctx.match[1], 10);
    const foodTypeId = parseInt(ctx.match[2], 10);
    const mealTypeId = parseInt(ctx.match[3], 10);
    const dayIdx = parseInt(ctx.match[4], 10);

    const client = await getClient(ctx);
    if (!client) return;

    try {
      const msg = await client.setFoodReservation(progId, foodTypeId, mealTypeId, true);
      await ctx.answerCallbackQuery({ text: `✅ ${msg}`, show_alert: true });
    } catch (e: any) {
      await ctx.answerCallbackQuery({ text: `❌ ${e.message}`, show_alert: true });
    }
  });

  bot.callbackQuery(/^do_cancel_(\d+)_(\d+)_(\d+)_(\d+)$/, async (ctx) => {
    const progId = parseInt(ctx.match[1], 10);
    const foodTypeId = parseInt(ctx.match[2], 10);
    const mealTypeId = parseInt(ctx.match[3], 10);

    const client = await getClient(ctx);
    if (!client) return;

    try {
      const msg = await client.setFoodReservation(progId, foodTypeId, mealTypeId, false);
      await ctx.answerCallbackQuery({ text: `✅ ${msg}`, show_alert: true });
    } catch (e: any) {
      await ctx.answerCallbackQuery({ text: `❌ ${e.message}`, show_alert: true });
    }
  });

  // ---------------- فروش روزانه (Daily sales) ----------------
  bot.callbackQuery("daily_sales_list", async (ctx) => {
    await ctx.answerCallbackQuery();
    const client = await getClient(ctx);
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

  bot.callbackQuery(/^buy_daily_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery("در حال ثبت خرید...");
    const client = await getClient(ctx);
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

  // ---------------- /self (انتخاب سلف پیش‌فرض) ----------------
  const handleSelectSelf = async (ctx: Context) => {
    const client = await getClient(ctx);
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

  bot.command("self", handleSelectSelf);
  bot.hears(BTN_SELF, handleSelectSelf);

  bot.callbackQuery(/^set_self_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const selfId = parseInt(ctx.match[1], 10);
    const telegramId = ctx.from!.id;

    const client = await getClient(ctx);
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

  // ---------------- پیام‌های متنی عادی (پاسخ به استپ‌های لاگین) ----------------
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    // Check if user is in an active session (e.g. login)
    const session = await kv.getUserSession(env.KV, telegramId);
    if (!session || !session.step) {
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
    }
  });

  return bot;
}
