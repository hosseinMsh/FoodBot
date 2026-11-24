import { Bot } from "grammy";
import { Env } from "./types";
import { getMainKeyboard, BotContextOptions } from "./handlers/common";
import { createAuthComposer } from "./handlers/auth";
import { createFavoritesComposer } from "./handlers/favorites";
import { createAutoReserveComposer } from "./handlers/autoreserve";
import { createTodayComposer } from "./handlers/today";
import { createNextWeekComposer } from "./handlers/nextweek";
import { createRemainingComposer } from "./handlers/remaining";
import { createCreditComposer } from "./handlers/credit";
import { createBuyComposer } from "./handlers/buy";
import { createSelfComposer } from "./handlers/self";
import { createMiniAppComposer } from "./handlers/miniapp";

export { getMainKeyboard };

/**
 * Creates and configures the GrammY bot instance for Cloudflare Workers.
 * Modular architecture with dedicated composers for each functional domain.
 */
export function createBot(env: Env, customApiRoot?: string, webAppUrl?: string): Bot {
  const isBale = env.PLATFORM?.toLowerCase() === "bale";
  const apiRoot =
    customApiRoot ||
    env.BOT_API_ROOT ||
    (isBale ? "https://tapi.bale.ai" : "https://api.telegram.org");

  const resolvedWebAppUrl = webAppUrl || env.MINIAPP_URL;

  const bot = new Bot(env.BOT_TOKEN, {
    client: {
      apiRoot,
    },
  });

  const options: BotContextOptions = {
    env,
    isBale,
    resolvedWebAppUrl,
  };

  // Catch unexpected bot errors
  bot.catch((err) => {
    console.error("Bot update error:", err);
  });

  // Mount composers in priority order
  bot.use(createAuthComposer(options));
  bot.use(createMiniAppComposer(options));
  bot.use(createFavoritesComposer(options));
  bot.use(createAutoReserveComposer(options));
  bot.use(createTodayComposer(options));
  bot.use(createNextWeekComposer(options));
  bot.use(createRemainingComposer(options));
  bot.use(createCreditComposer(options));
  bot.use(createBuyComposer(options));
  bot.use(createSelfComposer(options));

  return bot;
}
