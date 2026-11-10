import { webhookCallback } from "grammy";
import { Env } from "./types";
import { createBot } from "./bot";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.toLowerCase();
    const queryPlatform = url.searchParams.get("platform")?.toLowerCase();

    // Determine platform and API root
    const isBale =
      queryPlatform === "bale" ||
      path === "/webhook/bale" ||
      (!queryPlatform && !path.includes("telegram") && env.PLATFORM?.toLowerCase() === "bale");

    const defaultPlatform = env.PLATFORM?.toLowerCase() === "bale" ? "bale" : "telegram";
    const apiRoot = env.BOT_API_ROOT || (isBale ? "https://tapi.bale.ai" : "https://api.telegram.org");

    // 1. Webhook endpoints: /webhook, /webhook/telegram, /webhook/bale
    if (
      (path === "/webhook" || path === "/webhook/telegram" || path === "/webhook/bale") &&
      request.method === "POST"
    ) {
      try {
        const bot = createBot(env, apiRoot);
        const handle = webhookCallback(bot, "cloudflare-mod");
        return await handle(request);
      } catch (err: any) {
        console.error("Webhook execution error:", err);
        return new Response(`Error: ${err.message}`, { status: 500 });
      }
    }

    // 2. Webhook Setup: /set-webhook or /setup
    // Allows query ?platform=telegram or ?platform=bale
    if (path === "/set-webhook" || path === "/setup") {
      const targetPlatform = queryPlatform || defaultPlatform;
      const targetIsBale = targetPlatform === "bale";
      const targetApiRoot = env.BOT_API_ROOT || (targetIsBale ? "https://tapi.bale.ai" : "https://api.telegram.org");
      const targetName = targetIsBale ? "Bale" : "Telegram";

      // Target webhook URL:
      // If setup explicitly for bale/telegram, route to specific sub-path or general /webhook
      const webhookUrl = `${url.origin}/webhook${targetIsBale ? "/bale" : "/telegram"}`;

      const res = await fetch(
        `${targetApiRoot}/bot${env.BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}&drop_pending_updates=true`
      );
      const json = await res.json();

      return new Response(
        JSON.stringify(
          {
            platform: targetName,
            apiRoot: targetApiRoot,
            targetWebhookUrl: webhookUrl,
            message: `${targetName} Webhook configuration result`,
            result: json,
          },
          null,
          2
        ),
        { headers: { "Content-Type": "application/json;charset=UTF-8" } }
      );
    }

    // 3. Webhook Info Check: /webhook-info
    if (path === "/webhook-info") {
      const targetPlatform = queryPlatform || defaultPlatform;
      const targetIsBale = targetPlatform === "bale";
      const targetApiRoot = env.BOT_API_ROOT || (targetIsBale ? "https://tapi.bale.ai" : "https://api.telegram.org");
      const targetName = targetIsBale ? "Bale" : "Telegram";

      const res = await fetch(`${targetApiRoot}/bot${env.BOT_TOKEN}/getWebhookInfo`);
      const json = await res.json();

      return new Response(
        JSON.stringify(
          {
            platform: targetName,
            apiRoot: targetApiRoot,
            info: json,
          },
          null,
          2
        ),
        { headers: { "Content-Type": "application/json;charset=UTF-8" } }
      );
    }

    // 4. Root / Health check & Quick Setup Dashboard
    const activePlatformName = defaultPlatform === "bale" ? "پیام‌رسان بله (Bale)" : "تلگرام (Telegram)";

    return new Response(
      `<!DOCTYPE html>
<html dir="rtl" lang="fa">
<head>
  <meta charset="utf-8">
  <title>FoodBot Serverless (Cloudflare Workers)</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; padding: 40px 20px; text-align: center; margin: 0; }
    .card { background: #1e293b; max-width: 600px; margin: 0 auto; border-radius: 16px; padding: 36px 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); border: 1px solid #334155; }
    h1 { color: #38bdf8; margin-top: 0; margin-bottom: 8px; font-size: 26px; }
    p { color: #94a3b8; line-height: 1.6; font-size: 15px; }
    .status { display: inline-flex; align-items: center; gap: 8px; color: #4ade80; font-weight: bold; margin-bottom: 16px; font-size: 14px; background: rgba(74, 222, 128, 0.1); padding: 6px 14px; border-radius: 999px; }
    .dot { width: 10px; height: 10px; background: #4ade80; border-radius: 50%; box-shadow: 0 0 8px #4ade80; }
    .platform-badge { display: inline-block; background: #0369a1; color: white; padding: 4px 12px; border-radius: 6px; font-size: 13px; font-weight: bold; margin-top: 4px; }
    .btn-group { display: flex; flex-direction: column; gap: 10px; margin-top: 24px; }
    .btn { display: block; background: #0284c7; color: white; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: bold; transition: 0.2s; font-size: 14px; }
    .btn:hover { background: #0369a1; }
    .btn-bale { background: #059669; }
    .btn-bale:hover { background: #047857; }
    .links { display: flex; justify-content: center; gap: 16px; margin-top: 18px; font-size: 13px; }
    .links a { color: #94a3b8; text-decoration: underline; }
    .links a:hover { color: #38bdf8; }
  </style>
</head>
<body>
  <div class="card">
    <div class="status"><div class="dot"></div> ربات فعال است (Cloudflare Workers)</div>
    <h1>🍽 FoodBot Serverless</h1>
    <p>سامانه اتوماسیون تغذیه صمد بر بستر سرورلس کلادفلر با پایگاه‌داده ابری D1 و کش سریع KV</p>
    <div class="platform-badge">پلتفرم پیش‌فرض: ${activePlatformName}</div>

    <div class="btn-group">
      <a href="/set-webhook?platform=telegram" class="btn">🚀 ثبت وب‌هوک تلگرام (/set-webhook?platform=telegram)</a>
      <a href="/set-webhook?platform=bale" class="btn btn-bale">🚀 ثبت وب‌هوک بله (/set-webhook?platform=bale)</a>
    </div>

    <div class="links">
      <a href="/webhook-info?platform=telegram">وضعیت وب‌هوک تلگرام</a>
      <span>•</span>
      <a href="/webhook-info?platform=bale">وضعیت وب‌هوک بله</a>
    </div>
  </div>
</body>
</html>`,
      { headers: { "Content-Type": "text/html;charset=UTF-8" } }
    );
  },
};
