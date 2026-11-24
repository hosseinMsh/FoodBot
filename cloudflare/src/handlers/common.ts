import { Context, InlineKeyboard, Keyboard } from "grammy";
import { Env } from "../types";
import { SamadClient } from "../samad";

// Main persistent keyboard button labels with clean Unicode icons (No stickers!)
export const BTN_TODAY = "🍽 غذای امروز و بارکد";
export const BTN_REMAINING = "📋 رزروهای مانده هفته";
export const BTN_NEXT_WEEK = "📅 منوی هفته آینده";
export const BTN_BUY = "🛒 خرید و رزرو غذا";
export const BTN_FAVORITES = "⭐️ غذاهای موردعلاقه";
export const BTN_AUTORESERVE = "🤖 رزرو خودکار هوشمند";
export const BTN_CREDIT = "💰 موجودی و شارژ";
export const BTN_CHARGE = "💳 افزایش اعتبار";
export const BTN_SELF = "⚙️ انتخاب سلف";
export const BTN_PROFILE = "👤 حساب کاربری";

export interface BotContextOptions {
  env: Env;
  isBale: boolean;
  resolvedWebAppUrl?: string;
}

/**
 * Returns the persistent reply keyboard for the main menu with balanced ergonomic rows.
 */
export function getMainKeyboard(): Keyboard {
  return new Keyboard()
    .text(BTN_TODAY)
    .text(BTN_REMAINING)
    .row()
    .text(BTN_NEXT_WEEK)
    .text(BTN_BUY)
    .row()
    .text(BTN_FAVORITES)
    .text(BTN_AUTORESERVE)
    .row()
    .text(BTN_CREDIT)
    .text(BTN_SELF)
    .row()
    .text(BTN_PROFILE)
    .resized();
}

/**
 * Resolves user-specific mini app URL with appended user_id query parameter.
 */
export function getUserWebAppUrl(resolvedWebAppUrl?: string, telegramId?: number): string | undefined {
  if (!resolvedWebAppUrl) return undefined;
  if (!telegramId) return resolvedWebAppUrl;
  const sep = resolvedWebAppUrl.includes("?") ? "&" : "?";
  return `${resolvedWebAppUrl}${sep}user_id=${telegramId}`;
}

/**
 * Ensures user is authenticated and returns active SamadClient, or sends login prompt.
 */
export async function getAuthenticatedClient(
  ctx: Context,
  options: BotContextOptions
): Promise<SamadClient | null> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return null;

  const client = await SamadClient.forUser(options.env, telegramId);
  if (!client) {
    const msg =
      "⚠️ <b>شما هنوز وارد حساب سامانه صمد خود نشده‌اید.</b>\n\n" +
      "برای اتصال به سامانه صمد، روی دکمه زیر کلیک کنید یا دستور /login را ارسال نمایید:";
    const kb = new InlineKeyboard().text("🔐 ورود به حساب صمد", "start_login");
    const userAppUrl = getUserWebAppUrl(options.resolvedWebAppUrl, telegramId);
    if (userAppUrl && !options.isBale) {
      kb.row().webApp("📱 ورود و استفاده از مینی‌اپ", userAppUrl);
    }
    await ctx.reply(msg, { parse_mode: "HTML", reply_markup: kb });
    return null;
  }
  return client;
}
