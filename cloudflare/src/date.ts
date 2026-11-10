import { DayProgram, FoodItem } from "./types";

const PERSIAN_WEEKDAYS: Record<number, string> = {
  0: "دوشنبه",
  1: "سه‌شنبه",
  2: "چهارشنبه",
  3: "پنجشنبه",
  4: "جمعه",
  5: "شنبه",
  6: "یکشنبه",
};

const ENGLISH_TO_PERSIAN_DAYS: Record<string, string> = {
  saturday: "شنبه",
  sunday: "یکشنبه",
  monday: "دوشنبه",
  tuesday: "سه‌شنبه",
  wednesday: "چهارشنبه",
  thursday: "پنجشنبه",
  friday: "جمعه",
};

export function toPersianDayName(name: string): string {
  if (!name) return "";
  const clean = name.trim().toLowerCase();
  return ENGLISH_TO_PERSIAN_DAYS[clean] || name;
}

export function gregorianToJalali(gy: number, gm: number, gd: number): [number, number, number] {
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = gy <= 1600 ? 0 : 979;
  gy -= gy <= 1600 ? 621 : 1600;
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days =
    365 * gy +
    Math.floor((gy2 + 3) / 4) -
    Math.floor((gy2 + 99) / 100) +
    Math.floor((gy2 + 399) / 400) -
    80 +
    gd +
    g_d_m[gm - 1];
  jy += 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  jy += Math.floor((days - 1) / 365);
  if (days > 0) days = (days - 1) % 365;
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return [jy, jm, jd];
}

export function toJalaliStr(d: Date): string {
  const [jy, jm, jd] = gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  const sm = String(jm).padStart(2, "0");
  const sd = String(jd).padStart(2, "0");
  return `${jy}/${sm}/${sd}`;
}

export function parseDate(dateStr: string): Date {
  const clean = dateStr.trim();
  const parts = clean.split(" ")[0].split("-");
  return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
}

export function getWeekSaturday(refDate?: Date): Date {
  const now = refDate ? new Date(refDate) : new Date();
  // In JS: Sunday is 0, Monday is 1, ..., Saturday is 6
  // We convert to: Monday is 0, ..., Saturday is 5, Sunday is 6
  const jsDay = now.getDay();
  const pyWeekday = jsDay === 0 ? 6 : jsDay - 1;
  const daysSinceSat = (pyWeekday - 5 + 7) % 7;
  const sat = new Date(now);
  sat.setDate(sat.getDate() - daysSinceSat);
  sat.setHours(0, 0, 0, 0);
  return sat;
}

export function formatDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day} 00:00:00`;
}

export function getCurrentWeekSaturdayStr(refDate?: Date): string {
  return formatDateStr(getWeekSaturday(refDate));
}

export function getNextWeekSaturdayStr(refDate?: Date): string {
  const sat = getWeekSaturday(refDate);
  sat.setDate(sat.getDate() + 7);
  return formatDateStr(sat);
}

export function formatToman(rials: number | null | undefined): string {
  if (rials == null) return "۰ تومان";
  const isNegative = rials < 0;
  const absRials = Math.abs(rials);
  const toman = Math.floor(absRials / 10);
  const rialsStr = absRials.toLocaleString("fa-IR");
  const tomanStr = toman.toLocaleString("fa-IR");
  if (isNegative) {
    return `-${tomanStr} تومان (${rialsStr}- ریال بدهی)`;
  }
  return `${tomanStr} تومان (${rialsStr} ریال)`;
}

export function normalizeWeeklyPrograms(progData: any): DayProgram[] {
  if (!progData || typeof progData !== "object") return [];

  const days: DayProgram[] = [];

  if (Array.isArray(progData.selfWeekPrograms)) {
    for (const dayItems of progData.selfWeekPrograms) {
      if (!Array.isArray(dayItems) || dayItems.length === 0) continue;
      const first = dayItems[0];
      const dateStr = first.date || "";
      const dayName = toPersianDayName(first.dayTranslated || "");
      const d = parseDate(dateStr);
      const dateJStr = toJalaliStr(d);

      const mealsMap = new Map<number, { mealTypeId: number; mealTypeTitle: string; foods: FoodItem[] }>();

      for (const item of dayItems) {
        const mId = item.mealTypeId || 1;
        const mTitle = item.mealTypeName || item.mealTypeTitle || "ناهار";
        if (!mealsMap.has(mId)) {
          mealsMap.set(mId, { mealTypeId: mId, mealTypeTitle: mTitle, foods: [] });
        }
        mealsMap.get(mId)!.foods.push({
          programId: item.programId,
          foodTypeId: item.foodTypeId,
          mealTypeId: mId,
          foodName: item.foodName || "غذا",
          price: item.price || 0,
          isReserved: !!item.isReserved,
          reserveRuleViolated: !!item.reserveRuleViolated,
        });
      }

      days.push({
        date: dateStr,
        dayTranslated: dayName,
        dateJStr,
        meals: Array.from(mealsMap.values()),
      });
    }
  } else if (Array.isArray(progData.days)) {
    return progData.days;
  }

  return days;
}
