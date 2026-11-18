import { Bot, InputFile } from "grammy";
import { Env, User } from "./types";
import * as db from "./db";
import { SamadClient } from "./samad";
import { getTehranTodayInfo } from "./date";
import { generateQrPng } from "./qr";

export interface ExtractedMeal {
  mealTitle: string;
  dayName: string;
  res: any;
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
