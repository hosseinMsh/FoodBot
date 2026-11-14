import { webhookCallback } from "grammy";
import { Env } from "./types";
import { createBot } from "./bot";
import { renderMiniAppHtml } from "./miniapp";
import * as db from "./db";
import { SamadClient } from "./samad";
import {
  getCurrentWeekSaturdayStr,
  getNextWeekSaturdayStr,
  toJalaliStr,
  normalizeWeeklyPrograms,
} from "./date";
import { generateQrPng } from "./qr";

function jsonResponse(data: any, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,X-Telegram-Init-Data",
    },
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.toLowerCase();
    const queryPlatform = url.searchParams.get("platform")?.toLowerCase();

    // Handle OPTIONS CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type,X-Telegram-Init-Data",
        },
      });
    }

    // Determine platform and API root
    const isBale =
      queryPlatform === "bale" ||
      path === "/webhook/bale" ||
      (!queryPlatform && !path.includes("telegram") && env.PLATFORM?.toLowerCase() === "bale");

    const defaultPlatform = env.PLATFORM?.toLowerCase() === "bale" ? "bale" : "telegram";
    const apiRoot = env.BOT_API_ROOT || (isBale ? "https://tapi.bale.ai" : "https://api.telegram.org");
    const webAppUrl = env.MINIAPP_URL || `${url.origin}/app`;
    const payUrl = env.PAY_SHARIF_URL || "https://pay.sharif.ir";

    // ==========================================
    // 1. Webhook endpoints: /webhook, /webhook/telegram, /webhook/bale
    // ==========================================
    if (
      (path === "/webhook" || path === "/webhook/telegram" || path === "/webhook/bale") &&
      request.method === "POST"
    ) {
      try {
        const bot = createBot(env, apiRoot, webAppUrl);
        const handle = webhookCallback(bot, "cloudflare-mod");
        return await handle(request);
      } catch (err: any) {
        console.error("Webhook execution error:", err);
        return new Response(`Error: ${err.message}`, { status: 500 });
      }
    }

    // ==========================================
    // 2. Telegram Mini App Frontend: /app, /miniapp, /webapp
    // ==========================================
    if (path === "/app" || path === "/miniapp" || path === "/webapp") {
      return new Response(renderMiniAppHtml(payUrl), {
        headers: {
          "Content-Type": "text/html;charset=UTF-8",
          "Cache-Control": "no-cache",
        },
      });
    }

    // ==========================================
    // 3. Mini App REST API Endpoints
    // ==========================================

    // GET /api/me - Profile, status and balance
    if (path === "/api/me" && request.method === "GET") {
      const userIdStr = url.searchParams.get("user_id") || url.searchParams.get("id");
      const telegramId = parseInt(userIdStr || "0", 10);
      if (!telegramId) {
        return jsonResponse({ logged_in: false, message: "شناسه تلگرام یافت نشد" });
      }

      const user = await db.getUser(env.DB, telegramId);
      if (!user || !user.access_token) {
        return jsonResponse({ logged_in: false });
      }

      let creditToman = 0;
      let creditRials = 0;
      try {
        const client = await SamadClient.forUser(env, telegramId);
        if (client) {
          const nurture = await client.getNurtureProfile();
          creditRials = nurture.currentCredit || 0;
          creditToman = Math.floor(creditRials / 10);
        }
      } catch {}

      return jsonResponse({
        logged_in: true,
        user: {
          telegram_id: user.telegram_id,
          username: user.username,
          full_name: user.full_name || user.username,
          selected_self_id: user.selected_self_id,
          selected_self_name: user.selected_self_name,
          credit_toman: creditToman,
          credit_rials: creditRials,
        },
      });
    }

    // POST /api/login - Log into Samad & save session
    if (path === "/api/login" && request.method === "POST") {
      const body: any = await request.json().catch(() => ({}));
      const telegramId = parseInt(body.telegram_id || "0", 10);
      if (!telegramId || !body.username || !body.password) {
        return jsonResponse({ success: false, message: "اطلاعات فرم ناقص است" }, 400);
      }

      const tempUser: any = {
        telegram_id: telegramId,
        username: body.username,
        access_token: "",
        refresh_token: "",
        token_expires_at: 0,
      };
      const client = new SamadClient(env, tempUser);

      try {
        await client.login(
          body.username,
          body.password,
          body.captcha_text,
          body.validation,
          body.nonce
        );

        let fullName = body.username;
        try {
          const prof = await client.getUserProfile();
          if (prof && (prof.firstName || prof.lastName)) {
            fullName = `${prof.firstName || ""} ${prof.lastName || ""}`.trim();
            await db.updateUserProfile(env.DB, telegramId, fullName);
          }
        } catch {}

        try {
          const selfs = await client.getAvailableSelfs();
          if (selfs.length > 0) {
            await db.updateSelectedSelf(env.DB, telegramId, selfs[0].id, selfs[0].name);
            tempUser.selected_self_id = selfs[0].id;
            tempUser.selected_self_name = selfs[0].name;
          }
        } catch {}

        let creditToman = 0;
        let creditRials = 0;
        try {
          const nurture = await client.getNurtureProfile();
          creditRials = nurture.currentCredit || 0;
          creditToman = Math.floor(creditRials / 10);
        } catch {}

        return jsonResponse({
          success: true,
          user: {
            telegram_id: telegramId,
            username: body.username,
            full_name: fullName,
            selected_self_id: tempUser.selected_self_id,
            selected_self_name: tempUser.selected_self_name,
            credit_toman: creditToman,
            credit_rials: creditRials,
          },
        });
      } catch (e: any) {
        return jsonResponse({ success: false, message: e.message || "خطا در احراز هویت" }, 400);
      }
    }

    // GET /api/captcha - Get new captcha image & nonce
    if (path === "/api/captcha" && request.method === "GET") {
      try {
        const client = new SamadClient(env);
        const captcha = await client.getCaptcha();
        return jsonResponse(captcha);
      } catch (e: any) {
        return jsonResponse({ message: e.message }, 500);
      }
    }

    // GET /api/today - Today's reserved meals
    if (path === "/api/today" && request.method === "GET") {
      const telegramId = parseInt(url.searchParams.get("user_id") || "0", 10);
      const client = await SamadClient.forUser(env, telegramId);
      if (!client) return jsonResponse({ error: "کاربر وارد نشده است" }, 401);

      try {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, "0");
        const d = String(now.getDate()).padStart(2, "0");
        const todayIso = `${y}-${m}-${d}`;

        const satStr = getCurrentWeekSaturdayStr(now);
        const resData = await client.getReservationInfo(satStr);

        const items = Array.isArray(resData) ? resData : resData?.items || [];
        const todayMeals = items.filter((item: any) => {
          const itemDate = (item.programDate || item.date || "").split(" ")[0];
          return itemDate === todayIso;
        });

        return jsonResponse({
          dateJalali: toJalaliStr(now),
          meals: todayMeals.map((meal: any) => ({
            reserveId: meal.reserveId || meal.id,
            foodName: meal.foodName || meal.foodTitle || "غذا",
            mealTypeName:
              meal.mealTypeName || (meal.mealTypeId === 1 ? "صبحانه" : meal.mealTypeId === 2 ? "ناهار" : "شام"),
            selfName: meal.selfName || "",
            price: meal.price || 0,
            state: meal.state,
            delivered: meal.state === 3 || meal.delivered,
          })),
        });
      } catch (e: any) {
        return jsonResponse({ error: e.message }, 500);
      }
    }

    // GET /api/programs - Weekly reservable meals
    if (path === "/api/programs" && request.method === "GET") {
      const telegramId = parseInt(url.searchParams.get("user_id") || "0", 10);
      const client = await SamadClient.forUser(env, telegramId);
      if (!client) return jsonResponse({ error: "کاربر وارد نشده است" }, 401);

      const user = await db.getUser(env.DB, telegramId);
      const selfId =
        parseInt(url.searchParams.get("self_id") || "0", 10) || user?.selected_self_id || 1;
      const weekOffset = parseInt(url.searchParams.get("week_offset") || "0", 10);
      const satStr = weekOffset === 1 ? getNextWeekSaturdayStr() : getCurrentWeekSaturdayStr();

      try {
        const progData = await client.getReservablePrograms(selfId, satStr);
        const normalized = normalizeWeeklyPrograms(progData);
        return jsonResponse({ days: normalized });
      } catch (e: any) {
        return jsonResponse({ error: e.message }, 500);
      }
    }

    // POST /api/reserve - Reserve / Cancel a meal
    if (path === "/api/reserve" && request.method === "POST") {
      const body: any = await request.json().catch(() => ({}));
      const telegramId = parseInt(body.telegram_id || "0", 10);
      const client = await SamadClient.forUser(env, telegramId);
      if (!client) return jsonResponse({ success: false, message: "کاربر وارد نشده است" }, 401);

      try {
        const msg = await client.setFoodReservation(
          body.program_id,
          body.food_type_id,
          body.meal_type_id,
          body.selected !== false
        );
        return jsonResponse({ success: true, message: msg });
      } catch (e: any) {
        return jsonResponse({ success: false, message: e.message }, 400);
      }
    }

    // GET /api/forget-code - Delivery code
    if (path === "/api/forget-code" && request.method === "GET") {
      const telegramId = parseInt(url.searchParams.get("user_id") || "0", 10);
      const reserveId = parseInt(url.searchParams.get("reserve_id") || "0", 10);
      const client = await SamadClient.forUser(env, telegramId);
      if (!client) return jsonResponse({ error: "کاربر وارد نشده است" }, 401);

      try {
        const data = await client.getForgetCode(reserveId);
        const code =
          data?.code || data?.forgetCode || data?.barcode || (typeof data === "string" ? data : "");
        return jsonResponse({ code: String(code || "") });
      } catch (e: any) {
        return jsonResponse({ error: e.message }, 500);
      }
    }

    // GET /api/qr - Generate QR Code image PNG
    if (path === "/api/qr" && request.method === "GET") {
      const text = url.searchParams.get("text") || "0";
      try {
        const qrBytes = await generateQrPng(text);
        return new Response(qrBytes, {
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": "public, max-age=86400",
          },
        });
      } catch {
        return new Response("QR generation error", { status: 500 });
      }
    }

    // GET /api/credit - Balance, payment link, token login, and transactions
    if (path === "/api/credit" && request.method === "GET") {
      const telegramId = parseInt(url.searchParams.get("user_id") || "0", 10);
      const client = await SamadClient.forUser(env, telegramId);
      if (!client) return jsonResponse({ success: false, message: "کاربر وارد نشده است" }, 401);

      try {
        const nurture = await client.getNurtureProfile();
        const currentCreditRials = nurture.currentCredit || 0;
        const creditToman = Math.floor(currentCreditRials / 10);

        let loginToken = "";
        try {
          loginToken = await client.getLoginToken();
        } catch {}

        const base = (env.SAMAD_BASE_URL || "https://setad.dining.sharif.edu/").replace(/\/+$/, "");
        const loginTokenUrl = loginToken ? `${base}/#/token-login?token=${loginToken}` : base;

        const items = Array.isArray(nurture.items) ? nurture.items : [];
        const txs = items.map((it: any) => ({
          description: it.receipt?.paymentSystemName || it.description || "تراکنش تغذیه",
          amount: it.amount || 0,
          date: it.createDate || it.actionDate || "",
        }));

        return jsonResponse({
          success: true,
          credit_rials: currentCreditRials,
          credit_toman: creditToman,
          pay_url: payUrl,
          loginTokenUrl,
          transactions: txs,
        });
      } catch (e: any) {
        return jsonResponse({ success: false, message: e.message }, 500);
      }
    }

    // GET /api/selfs - List all available dining halls
    if (path === "/api/selfs" && request.method === "GET") {
      const telegramId = parseInt(url.searchParams.get("user_id") || "0", 10);
      const client = await SamadClient.forUser(env, telegramId);
      if (!client) return jsonResponse({ selfs: [] });
      try {
        const selfs = await client.getAvailableSelfs();
        return jsonResponse({ selfs });
      } catch {
        return jsonResponse({ selfs: [] });
      }
    }

    // POST /api/select-self - Update user's active self
    if (path === "/api/select-self" && request.method === "POST") {
      const body: any = await request.json().catch(() => ({}));
      const telegramId = parseInt(body.telegram_id || "0", 10);
      if (telegramId && body.self_id) {
        await db.updateSelectedSelf(env.DB, telegramId, body.self_id, body.self_name || "سلف");
        return jsonResponse({ success: true });
      }
      return jsonResponse({ success: false }, 400);
    }

    // POST /api/logout - End session
    if (path === "/api/logout" && request.method === "POST") {
      const body: any = await request.json().catch(() => ({}));
      const telegramId = parseInt(body.telegram_id || "0", 10);
      if (telegramId) {
        await db.deleteUser(env.DB, telegramId);
        return jsonResponse({ success: true });
      }
      return jsonResponse({ success: false }, 400);
    }

    // ==========================================
    // 4. Webhook Setup: /set-webhook or /setup
    // ==========================================
    if (path === "/set-webhook" || path === "/setup") {
      const targetPlatform = queryPlatform || defaultPlatform;
      const targetIsBale = targetPlatform === "bale";
      const targetApiRoot = env.BOT_API_ROOT || (targetIsBale ? "https://tapi.bale.ai" : "https://api.telegram.org");
      const targetName = targetIsBale ? "Bale" : "Telegram";

      const webhookUrl = `${url.origin}/webhook${targetIsBale ? "/bale" : "/telegram"}`;

      const res = await fetch(
        `${targetApiRoot}/bot${env.BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}&drop_pending_updates=true`
      );
      const json = await res.json();

      // Configure Telegram chat menu button to point to Mini App
      let menuButtonResult: any = null;
      if (!targetIsBale) {
        try {
          const mbRes = await fetch(`${targetApiRoot}/bot${env.BOT_TOKEN}/setChatMenuButton`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              menu_button: {
                type: "web_app",
                text: "🍽 مینی‌اپ صمد",
                web_app: { url: webAppUrl },
              },
            }),
          });
          menuButtonResult = await mbRes.json();
        } catch (e: any) {
          menuButtonResult = { error: e.message };
        }
      }

      return new Response(
        JSON.stringify(
          {
            platform: targetName,
            apiRoot: targetApiRoot,
            targetWebhookUrl: webhookUrl,
            miniappUrl: webAppUrl,
            message: `${targetName} Webhook configuration result`,
            result: json,
            menuButton: menuButtonResult,
          },
          null,
          2
        ),
        { headers: { "Content-Type": "application/json;charset=UTF-8" } }
      );
    }

    // ==========================================
    // 5. Webhook Info Check: /webhook-info
    // ==========================================
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

    // ==========================================
    // 6. Root / Health check & Quick Setup Dashboard
    // ==========================================
    const activePlatformName = defaultPlatform === "bale" ? "پیام‌رسان بله (Bale)" : "تلگرام (Telegram)";

    return new Response(
      `<!DOCTYPE html>
<html dir="rtl" lang="fa">
<head>
  <meta charset="utf-8">
  <title>FoodBot Serverless (Cloudflare Workers)</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; padding: 40px 20px; text-align: center; margin: 0; }
    .card { background: #1e293b; max-width: 620px; margin: 0 auto; border-radius: 16px; padding: 36px 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); border: 1px solid #334155; }
    h1 { color: #38bdf8; margin-top: 0; margin-bottom: 8px; font-size: 26px; }
    p { color: #94a3b8; line-height: 1.6; font-size: 15px; }
    .status { display: inline-flex; align-items: center; gap: 8px; color: #4ade80; font-weight: bold; margin-bottom: 16px; font-size: 14px; background: rgba(74, 222, 128, 0.1); padding: 6px 14px; border-radius: 999px; }
    .dot { width: 10px; height: 10px; background: #4ade80; border-radius: 50%; box-shadow: 0 0 8px #4ade80; }
    .platform-badge { display: inline-block; background: #0369a1; color: white; padding: 4px 12px; border-radius: 6px; font-size: 13px; font-weight: bold; margin-top: 4px; }
    .btn-group { display: flex; flex-direction: column; gap: 10px; margin-top: 24px; }
    .btn { display: block; background: #0284c7; color: white; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: bold; transition: 0.2s; font-size: 14px; }
    .btn:hover { background: #0369a1; }
    .btn-app { background: linear-gradient(135deg, #0284c7 0%, #38bdf8 100%); color: white; box-shadow: 0 4px 14px rgba(2, 132, 199, 0.3); }
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
    <h1>🍽 FoodBot Serverless & Mini App</h1>
    <p>سامانه جامع اتوماسیون تغذیه صمد بر بستر سرورلس کلادفلر با مینی‌اپ اختصاصی تلگرام و پایگاه‌داده D1</p>
    <div class="platform-badge">پلتفرم جاری: ${activePlatformName}</div>

    <div class="btn-group">
      <a href="/app" class="btn btn-app">📱 باز کردن مینی‌اپ صمد (/app)</a>
      <a href="/set-webhook?platform=telegram" class="btn">🚀 ثبت وب‌هوک و منوبار تلگرام (/set-webhook)</a>
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
