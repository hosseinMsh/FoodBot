import { Bot, InlineKeyboard, InputFile } from "grammy";
import {
  Env,
  User,
  AutoReserveSummary,
  AutoReserveUserSummary,
  AutoReserveResultItem,
  LowCreditAlertItem,
  DayProgram,
} from "./types";
import * as db from "./db";
import { SamadClient } from "./samad";
import {
  getTehranTodayInfo,
  formatToman,
  getCurrentWeekSaturdayStr,
  getNextWeekSaturdayStr,
  normalizeWeeklyPrograms,
} from "./date";
import { generateQrPng } from "./qr";

export interface ExtractedMeal {
  mealTitle: string;
  dayName: string;
  res: any;
}

/**
 * Normalizes Persian/Arabic text for accurate food name keyword matching.
 */
export function normalizePersianText(str: string): string {
  if (!str) return "";
  return str
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/ة|ۀ/g, "ه")
    .replace(/\u200c/g, " ") // Zero-width non-joiner to space
    .replace(/[\u064B-\u065F]/g, "") // Diacritics
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Checks whether a food name matches any of the user's favorite keywords.
 */
export function matchFavoriteFood(foodName: string, favorites: string[]): string | null {
  const normFood = normalizePersianText(foodName);
  for (const fav of favorites) {
    const normFav = normalizePersianText(fav);
    if (!normFav) continue;
    if (normFood.includes(normFav) || normFav.includes(normFood)) {
      return fav;
    }
  }
  return null;
}

/**
 * Extracts all reserved meals matching todayIso (YYYY-MM-DD) from Samad's /rest/reserves response.
 */
export function extractTodayMeals(resData: any, todayIso: string): ExtractedMeal[] {
  const meals: ExtractedMeal[] = [];
  if (!resData || typeof resData !== "object") return meals;

  const weekDays = Array.isArray(resData.weekDays) ? resData.weekDays : [];
  if (weekDays.length > 0) {
    for (const day of weekDays) {
      const dayDate = String(day.date || "").split(" ")[0];
      if (dayDate !== todayIso) continue;

      const dayName = day.dayTranslated || "";
      for (const mt of day.mealTypes || []) {
        const mTitle = mt.name || mt.mealTypeTitle || "ناهار";
        const resList: any[] = [];
        if (mt.reserve && typeof mt.reserve === "object") resList.push(mt.reserve);
        if (Array.isArray(mt.reserves)) resList.push(...mt.reserves);

        for (const r of resList) {
          if (r && r.id) {
            meals.push({ mealTitle: mTitle, dayName, res: r });
          }
        }
      }
    }
    return meals;
  }

  // Fallback for flat list structure if Samad ever changes envelope
  const items = Array.isArray(resData) ? resData : Array.isArray(resData.items) ? resData.items : [];
  for (const item of items) {
    const itemDate = String(item.programDate || item.date || "").split(" ")[0];
    if (itemDate === todayIso && (item.id || item.reserveId)) {
      meals.push({
        mealTitle:
          item.mealTypeName ||
          (item.mealTypeId === 1 ? "ناهار" : item.mealTypeId === 2 ? "شام" : "وعده"),
        dayName: "",
        res: item,
      });
    }
  }
  return meals;
}

export interface DailyDispatchSummary {
  date: string;
  jalaliDate: string;
  dayName: string;
  skippedByDay?: boolean;
  usersChecked: number;
  mealsSent: number;
  mealsSkippedAlreadySent: number;
  errors: string[];
}

/**
 * Automatically checks all active users for today's reserved meals and sends
 * their delivery/forget-card code + QR code image via Telegram/Bale.
 * Scheduled via Cloudflare Cron Triggers at 07:30 UTC (11:00 AM Asia/Tehran), Sat-Wed.
 */
export async function sendDailyMealCodes(
  env: Env,
  options?: { force?: boolean; targetUserId?: number }
): Promise<DailyDispatchSummary> {
  const today = getTehranTodayInfo();
  const summary: DailyDispatchSummary = {
    date: today.isoDate,
    jalaliDate: today.jalaliDate,
    dayName: today.persianDayName,
    usersChecked: 0,
    mealsSent: 0,
    mealsSkippedAlreadySent: 0,
    errors: [],
  };

  // Double-check Iran day-of-week: Sat(6), Sun(0), Mon(1), Tue(2), Wed(3)
  const allowedDays = [6, 0, 1, 2, 3];
  if (!options?.force && !allowedDays.includes(today.dayOfWeek)) {
    summary.skippedByDay = true;
    return summary;
  }

  const isBale = env.PLATFORM?.toLowerCase() === "bale";
  const apiRoot = env.BOT_API_ROOT || (isBale ? "https://tapi.bale.ai" : "https://api.telegram.org");
  const bot = new Bot(env.BOT_TOKEN, {
    client: { apiRoot },
  });

  let users: User[] = [];
  if (options?.targetUserId) {
    const single = await db.getUser(env.DB, options.targetUserId);
    if (single && single.access_token) users = [single];
  } else {
    users = await db.getAutoSendUsers(env.DB);
  }

  for (const user of users) {
    summary.usersChecked++;
    try {
      const client = new SamadClient(env, user);
      const resData = await client.getReservationInfo(today.weekSaturdayStr);
      const todayMeals = extractTodayMeals(resData, today.isoDate);

      // Filter to active, unconsumed, unsold meals
      const pendingMeals = todayMeals.filter(
        ({ res }) => !res.consumed && !res.sold && res.selected !== false
      );

      if (pendingMeals.length === 0) {
        continue;
      }

      for (const item of pendingMeals) {
        const r = item.res;
        const reserveId = r.id || r.reserveId;
        if (!reserveId) continue;

        const sentKey = `daily_code_sent:${today.isoDate}:${user.telegram_id}:${reserveId}`;
        if (!options?.force) {
          const alreadySent = await env.KV.get(sentKey);
          if (alreadySent) {
            summary.mealsSkippedAlreadySent++;
            continue;
          }
        }

        try {
          const codeData = await client.getForgetCode(reserveId, !!r.dailySell);
          const forgotCode = codeData?.forgotCardCode;
          if (!forgotCode) {
            summary.errors.push(`User ${user.telegram_id} reserve ${reserveId}: empty forgotCardCode`);
            continue;
          }

          const foodName = (codeData.foodName || r.foodNames || r.foodName || "غذا").replace(/\|+$/, "");
          const selfName = codeData.self || r.selfName || r.self || "سلف";
          const meal = codeData.meal || item.mealTitle || "وعده";
          const dayName = item.dayName || today.persianDayName;

          const qrBuffer = generateQrPng(String(forgotCode));

          const caption =
            `☀️ <b>یادآوری غذای امروز و کد تحویل خودکار</b>\n` +
            `📅 <b>${dayName} - ${today.jalaliDate}</b>\n\n` +
            `🔢 <b>کد تحویل:</b> <code>${forgotCode}</code>\n` +
            `🍽 <b>غذا:</b> ${foodName}\n` +
            `🥣 <b>وعده:</b> ${meal}\n` +
            `🏛 <b>سلف:</b> ${selfName}\n\n` +
            "📲 <i>این بارکد (QR Code) یا کد عددی را می‌توانید مستقیماً جلوی اسکنر سلف قرار دهید.</i>\n" +
            "⚙️ <i>مدیریت ارسال خودکار ساعت ۱۱: /autocode</i>";

          await bot.api.sendPhoto(user.telegram_id, new InputFile(qrBuffer, "qrcode.png"), {
            caption,
            parse_mode: "HTML",
          });

          await env.KV.put(sentKey, "1", { expirationTtl: 86400 });
          summary.mealsSent++;
        } catch (mealErr: any) {
          summary.errors.push(
            `User ${user.telegram_id} reserve ${reserveId}: ${mealErr?.message || String(mealErr)}`
          );
        }
      }
    } catch (userErr: any) {
      summary.errors.push(
        `User ${user.telegram_id}: ${userErr?.message || String(userErr)}`
      );
    }
  }

  return summary;
}

/**
 * Intelligent Auto-Reservation Engine:
 * Scans upcoming open days (both current week remaining days & next week) for users
 * who enabled auto-reservation, matches offered foods with user's favorite foods list,
 * verifies budget & rules, performs reservation in Samad, and dispatches detailed notifications.
 */
export async function runAutoReserveEngine(
  env: Env,
  options?: { targetUserId?: number }
): Promise<AutoReserveSummary> {
  const isBale = env.PLATFORM?.toLowerCase() === "bale";
  const apiRoot = env.BOT_API_ROOT || (isBale ? "https://tapi.bale.ai" : "https://api.telegram.org");
  const bot = new Bot(env.BOT_TOKEN, { client: { apiRoot } });

  const summary: AutoReserveSummary = {
    timestamp: Date.now(),
    usersProcessed: 0,
    mealsReserved: 0,
    summaries: [],
  };

  let users: User[] = [];
  if (options?.targetUserId) {
    const single = await db.getUser(env.DB, options.targetUserId);
    if (single && single.access_token) users = [single];
  } else {
    users = await db.getAutoReserveUsers(env.DB);
  }

  const today = getTehranTodayInfo();
  const currentSat = getCurrentWeekSaturdayStr();
  const nextSat = getNextWeekSaturdayStr();

  for (const user of users) {
    summary.usersProcessed++;
    const userSummary: AutoReserveUserSummary = {
      telegramId: user.telegram_id,
      reservedMeals: [],
      lowCreditAlerts: [],
      errors: [],
    };

    try {
      const favorites = await db.getFavoriteFoods(env.DB, user.telegram_id);
      if (favorites.length === 0) {
        continue;
      }

      const client = new SamadClient(env, user);

      // Check current wallet balance
      let currentCreditRials = 0;
      try {
        const nurture = await client.getNurtureProfile();
        currentCreditRials = nurture.currentCredit || nurture.credit || 0;
      } catch {}

      const selfId = user.selected_self_id || 1;
      const candidatePrograms: DayProgram[] = [];

      // 1. Fetch current week remaining days (from today onward)
      try {
        const curData = await client.getReservablePrograms(selfId, currentSat);
        const curDays = normalizeWeeklyPrograms(curData);
        candidatePrograms.push(...curDays.filter((d) => (d.date || "") >= today.isoDate));
      } catch {}

      // 2. Fetch next week days (if open)
      try {
        const nextData = await client.getReservablePrograms(selfId, nextSat);
        const nextDays = normalizeWeeklyPrograms(nextData);
        candidatePrograms.push(...nextDays);
      } catch {}

      for (const day of candidatePrograms) {
        for (const meal of day.meals) {
          // Check if already reserved
          const alreadyReserved = meal.foods.some((f) => f.isReserved);
          if (alreadyReserved) continue;

          // Find candidate foods matching favorites
          const matchedFoods = meal.foods.filter(
            (f) => !f.reserveRuleViolated && matchFavoriteFood(f.foodName, favorites) !== null
          );

          if (matchedFoods.length === 0) continue;

          // Pick the first matched favorite food
          const selectedFood = matchedFoods[0];

          // Check if balance is sufficient
          if (currentCreditRials < selectedFood.price) {
            userSummary.lowCreditAlerts.push({
              foodName: selectedFood.foodName,
              requiredToman: Math.floor(selectedFood.price / 10),
              balanceToman: Math.floor(currentCreditRials / 10),
              mealTitle: meal.mealTypeTitle,
              dayTitle: `${day.dayTranslated} (${day.dateJStr})`,
            });
            continue;
          }

          // Perform reservation
          try {
            await client.setFoodReservation(
              selectedFood.programId,
              selectedFood.foodTypeId,
              selectedFood.mealTypeId,
              true
            );

            currentCreditRials -= selectedFood.price;
            selectedFood.isReserved = true;

            const resItem: AutoReserveResultItem = {
              programId: selectedFood.programId,
              foodName: selectedFood.foodName,
              dayTranslated: day.dayTranslated,
              dateJStr: day.dateJStr,
              mealTitle: meal.mealTypeTitle,
              selfName: user.selected_self_name || "سلف",
              price: selectedFood.price,
            };

            userSummary.reservedMeals.push(resItem);
            summary.mealsReserved++;

            // Set KV marker
            await env.KV.put(
              `auto_reserved:${day.date}:${user.telegram_id}:${selectedFood.programId}`,
              "1",
              { expirationTtl: 86400 * 14 }
            );
          } catch (reserveErr: any) {
            userSummary.errors.push(
              `خطا در رزرو ${selectedFood.foodName}: ${reserveErr.message || String(reserveErr)}`
            );
          }
        }
      }

      // Send Success Notification to User
      if (userSummary.reservedMeals.length > 0) {
        let msg =
          `🤖 <b>رزرو خودکار هوشمند غذا با موفقیت انجام شد!</b>\n\n` +
          `غذاهای زیر بر اساس لیست ⭐️ <b>علاقه‌مندی‌های شما</b> برای روزهای پیش‌رو رزرو شدند:\n\n`;

        for (const r of userSummary.reservedMeals) {
          msg +=
            `🗓 <b>${r.dayTranslated} (${r.dateJStr}) - ${r.mealTitle}</b>\n` +
            `🍱 <b>${r.foodName}</b>\n` +
            `🏛 ${r.selfName} | 💰 ${formatToman(r.price)}\n` +
            `─────────────────\n`;
        }
        msg +=
          `💳 مانده اعتبار کیف پول شما: <b>${formatToman(currentCreditRials)}</b>\n\n` +
          `⚙️ <i>مدیریت علاقه‌مندی‌ها و تنظیمات رزرو خودکار: /autoreserve</i>`;

        await bot.api.sendMessage(user.telegram_id, msg, { parse_mode: "HTML" }).catch(() => {});
      }

      // Send Low Credit Warning to User if applicable
      if (userSummary.lowCreditAlerts.length > 0) {
        let alertMsg =
          `⚠️ <b>هشدار کسری موجودی برای رزرو خودکار صمد</b>\n\n` +
          `غذاهای موردعلاقه شما در منوی سلف موجود است، اما موجودی حساب شما برای رزرو کافی نیست:\n\n`;

        for (const a of userSummary.lowCreditAlerts) {
          alertMsg +=
            `🍱 <b>${a.foodName}</b> (${a.mealTitle})\n` +
            `🗓 <b>${a.dayTitle}</b>\n` +
            `💵 هزینه غذا: <b>${a.requiredToman.toLocaleString("fa-IR")} تومان</b>\n` +
            `💰 موجودی فعلی: <b>${a.balanceToman.toLocaleString("fa-IR")} تومان</b>\n` +
            `─────────────────\n`;
        }
        alertMsg += `👇 جهت شارژ آنلاین کیف پول صمد و ثبت رزروها، روی دکمه زیر کلیک کنید:`;

        let loginToken = "";
        try {
          loginToken = await client.getLoginToken();
        } catch {}

        const basePayUrl =
          env.PAY_SHARIF_URL || "https://setad.dining.sharif.edu/nurture/user/credit/charge/view.rose";
        const sep = basePayUrl.includes("?") ? "&" : "?";
        const chargeUrl = loginToken
          ? `${basePayUrl}${sep}token=${loginToken}&loginToken=${loginToken}&loginAsToken=${loginToken}`
          : basePayUrl;

        const kb = new InlineKeyboard().url("💳 افزایش موجودی آنلاین (view.rose)", chargeUrl);
        await bot.api
          .sendMessage(user.telegram_id, alertMsg, { parse_mode: "HTML", reply_markup: kb })
          .catch(() => {});
      }
    } catch (err: any) {
      userSummary.errors.push(`User processing error: ${err.message || String(err)}`);
    }

    summary.summaries.push(userSummary);
  }

  return summary;
}
