/**
 * FoodBot Telegram Mini App (TMA) - Optimized Single-Page Application
 * Pure HTML5, modern CSS3 (Telegram theme adaptive), and Vanilla ES6+ JavaScript.
 * Loads in < 100ms with zero heavy framework bloat.
 */

export function renderMiniAppHtml(payUrl: string = "https://pay.sharif.ir"): string {
  return `<!DOCTYPE html>
<html dir="rtl" lang="fa">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>سامانه تغذیه صمد - FoodBot</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <link rel="preconnect" href="https://cdn.jsdelivr.net">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css">
  <style>
    :root {
      --bg: var(--tg-theme-bg-color, #0f172a);
      --text: var(--tg-theme-text-color, #f8fafc);
      --hint: var(--tg-theme-hint-color, #94a3b8);
      --link: var(--tg-theme-link-color, #38bdf8);
      --button: var(--tg-theme-button-color, #0284c7);
      --button-text: var(--tg-theme-button-text-color, #ffffff);
      --sec-bg: var(--tg-theme-secondary-bg-color, #1e293b);
      --card-bg: var(--tg-theme-secondary-bg-color, #1e293b);
      --border: rgba(255, 255, 255, 0.08);
      --success: #22c55e;
      --danger: #ef4444;
      --warning: #f59e0b;
      --accent: #0ea5e9;
      --radius: 14px;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }

    body {
      font-family: 'Vazirmatn', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding-bottom: 80px;
      user-select: none;
      -webkit-user-select: none;
      overflow-x: hidden;
    }

    /* Top App Bar */
    header {
      position: sticky;
      top: 0;
      z-index: 40;
      background: var(--bg);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--border);
      padding: 12px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .user-info { display: flex; flex-direction: column; }
    .user-name { font-weight: 700; font-size: 15px; }
    .user-sub { font-size: 12px; color: var(--hint); display: flex; align-items: center; gap: 4px; }
    .balance-badge {
      background: rgba(14, 165, 233, 0.12);
      color: var(--link);
      border: 1px solid rgba(14, 165, 233, 0.25);
      border-radius: 20px;
      padding: 6px 12px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    /* Tabs */
    .tab-content { display: none; padding: 16px; animation: fadeIn 0.2s ease-in-out; }
    .tab-content.active { display: block; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }

    /* Bottom Navigation Bar */
    nav.bottom-nav {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: 64px;
      background: var(--sec-bg);
      border-top: 1px solid var(--border);
      display: flex;
      justify-content: space-around;
      align-items: center;
      z-index: 50;
      padding-bottom: env(safe-area-inset-bottom);
    }

    .nav-item {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: var(--hint);
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      padding: 6px 0;
      transition: color 0.15s;
    }

    .nav-item.active { color: var(--link); font-weight: 700; }
    .nav-icon { font-size: 20px; margin-bottom: 2px; }

    /* Cards & Components */
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 16px;
      margin-bottom: 14px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.1);
    }

    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 8px;
    }

    .card-title { font-size: 15px; font-weight: 700; display: flex; align-items: center; gap: 8px; }

    /* Buttons */
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      background: var(--button);
      color: var(--button-text);
      border: none;
      border-radius: 10px;
      padding: 12px 16px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.15s ease;
      text-decoration: none;
    }

    .btn:active { transform: scale(0.98); opacity: 0.9; }
    .btn-pay { background: linear-gradient(135deg, #059669 0%, #10b981 100%); color: white; box-shadow: 0 4px 14px rgba(16, 185, 129, 0.3); }
    .btn-secondary { background: rgba(255, 255, 255, 0.08); color: var(--text); }
    .btn-danger { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
    .btn-sm { width: auto; padding: 6px 14px; font-size: 12px; border-radius: 8px; }

    /* Badge */
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
    }
    .badge-success { background: rgba(34, 197, 94, 0.15); color: var(--success); }
    .badge-warning { background: rgba(245, 158, 11, 0.15); color: var(--warning); }
    .badge-danger { background: rgba(239, 68, 68, 0.15); color: var(--danger); }
    .badge-info { background: rgba(14, 165, 233, 0.15); color: var(--link); }

    /* Meal Item */
    .meal-box {
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px;
      margin-bottom: 10px;
      background: rgba(255, 255, 255, 0.02);
    }
    .meal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
    .meal-type { font-size: 12px; font-weight: 700; color: var(--hint); }
    .food-title { font-size: 14px; font-weight: 700; color: var(--text); margin-bottom: 4px; }
    .meal-meta { display: flex; justify-content: space-between; font-size: 12px; color: var(--hint); margin-top: 6px; }

    /* Day Selector Pills */
    .pill-scroll {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding-bottom: 8px;
      margin-bottom: 14px;
      scrollbar-width: none;
    }
    .pill-scroll::-webkit-scrollbar { display: none; }
    .day-pill {
      flex: 0 0 auto;
      background: var(--sec-bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 8px 14px;
      font-size: 13px;
      font-weight: 600;
      color: var(--hint);
      cursor: pointer;
      text-align: center;
      transition: all 0.15s;
    }
    .day-pill.active {
      background: var(--button);
      color: var(--button-text);
      border-color: var(--button);
      box-shadow: 0 4px 12px rgba(2, 132, 199, 0.3);
    }
    .day-pill-sub { font-size: 10px; opacity: 0.8; display: block; margin-top: 2px; }

    /* Modal */
    .modal-backdrop {
      display: none;
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.7);
      backdrop-filter: blur(4px);
      z-index: 100;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .modal-backdrop.show { display: flex; }
    .modal-box {
      background: var(--sec-bg);
      border: 1px solid var(--border);
      border-radius: 20px;
      width: 100%;
      max-width: 360px;
      padding: 24px 20px;
      text-align: center;
      box-shadow: 0 20px 40px rgba(0,0,0,0.5);
      animation: popIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes popIn { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }

    .qr-img { width: 190px; height: 190px; border-radius: 12px; margin: 16px auto; display: block; background: white; padding: 8px; }
    .forget-code-text { font-size: 28px; font-weight: 900; letter-spacing: 4px; color: var(--link); margin: 8px 0; font-family: monospace; }

    /* Inputs */
    .form-group { margin-bottom: 14px; text-align: right; }
    .form-label { display: block; font-size: 12px; font-weight: 600; color: var(--hint); margin-bottom: 6px; }
    .form-control {
      width: 100%;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--border);
      border-radius: 10px;
      color: var(--text);
      font-family: inherit;
      padding: 12px 14px;
      font-size: 14px;
      outline: none;
      transition: border-color 0.15s;
    }
    .form-control:focus { border-color: var(--link); }

    /* Skeleton Loading */
    .skeleton {
      background: linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.03) 75%);
      background-size: 200% 100%;
      animation: shimmer 1.5s infinite;
      border-radius: 8px;
    }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

    /* Toast */
    #toast {
      position: fixed;
      bottom: 74px;
      left: 50%;
      transform: translateX(-50%) translateY(20px);
      background: #1e293b;
      color: white;
      border: 1px solid var(--border);
      border-radius: 24px;
      padding: 10px 20px;
      font-size: 13px;
      font-weight: 600;
      opacity: 0;
      pointer-events: none;
      transition: all 0.25s ease;
      z-index: 120;
      box-shadow: 0 10px 25px rgba(0,0,0,0.3);
      white-space: nowrap;
    }
    #toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
  </style>
</head>
<body>

  <!-- Header -->
  <header>
    <div class="user-info">
      <span class="user-name" id="head-user-name">در حال اتصال...</span>
      <span class="user-sub" id="head-self-name">🏛 سلف: در حال بارگذاری</span>
    </div>
    <div class="balance-badge" id="head-balance" onclick="switchTab('wallet')">
      💰 <span id="head-balance-toman">--</span>
    </div>
  </header>

  <!-- TAB 1: TODAY (امروز) -->
  <div id="tab-today" class="tab-content active">
    <div class="card">
      <div class="card-header">
        <span class="card-title">🍽 وعده‌های امروز</span>
        <span class="badge badge-info" id="today-date-str">...</span>
      </div>
      <div id="today-meals-container">
        <div class="skeleton" style="height: 90px; margin-bottom: 10px;"></div>
        <div class="skeleton" style="height: 90px;"></div>
      </div>
    </div>

    <!-- Quick Recharge Card -->
    <div class="card" style="background: linear-gradient(135deg, rgba(5,150,105,0.15) 0%, rgba(2,132,199,0.15) 100%); border-color: rgba(16,185,129,0.25);">
      <div class="card-title" style="margin-bottom: 8px;">💳 شارژ سریع حساب تغذیه</div>
      <p style="font-size: 12px; color: var(--hint); margin-bottom: 12px;">اتصال مستقیم به سامانه متمرکز پرداخت دانشگاه صنعتی شریف (pay.sharif.ir) متصل به حساب صمد</p>
      <button class="btn btn-pay" onclick="openDirectPayment()">
        💳 افزایش مستقیم اعتبار در pay.sharif.ir
      </button>
    </div>
  </div>

  <!-- TAB 2: RESERVE (رزرو غذا) -->
  <div id="tab-reserve" class="tab-content">
    <div style="display: flex; gap: 8px; margin-bottom: 12px;">
      <button class="btn btn-secondary btn-sm active" id="week-btn-current" onclick="switchWeek(0)" style="flex:1;">هفته جاری</button>
      <button class="btn btn-secondary btn-sm" id="week-btn-next" onclick="switchWeek(1)" style="flex:1;">هفته آینده</button>
    </div>

    <div class="pill-scroll" id="reserve-day-pills">
      <!-- Generated via JS -->
    </div>

    <div class="card" style="margin-bottom: 12px;">
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <span style="font-size: 13px; font-weight: 700;">انتخاب سلف:</span>
        <select id="reserve-self-select" class="form-control" style="width: auto; padding: 6px 12px; font-size: 12px;" onchange="changeReserveSelf()">
          <option value="">در حال بارگذاری...</option>
        </select>
      </div>
    </div>

    <div id="reserve-meals-container">
      <div class="skeleton" style="height: 110px; margin-bottom: 10px;"></div>
      <div class="skeleton" style="height: 110px;"></div>
    </div>
  </div>

  <!-- TAB 3: WALLET (کیف پول و شارژ) -->
  <div id="tab-wallet" class="tab-content">
    <div class="card" style="text-align: center; padding: 24px 16px;">
      <span style="font-size: 13px; color: var(--hint);">موجودی کیف پول تغذیه</span>
      <div style="font-size: 30px; font-weight: 900; color: var(--link); margin: 8px 0;" id="wallet-balance-toman">
        ۰ تومان
      </div>
      <span style="font-size: 12px; color: var(--hint);" id="wallet-balance-rials">۰ ریال</span>

      <div style="margin-top: 20px; display: flex; flex-direction: column; gap: 10px;">
        <button class="btn btn-pay" onclick="openDirectPayment()">
          💳 افزایش اعتبار در pay.sharif.ir
        </button>
        <button class="btn btn-secondary" onclick="openSamadTokenLogin()">
          🔗 ورود سریع به وب سامانه صمد
        </button>
        <button class="btn btn-secondary btn-sm" onclick="loadCreditInfo(true)">
          🔄 بروزرسانی آنی موجودی
        </button>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <span class="card-title">📜 آخرین تراکنش‌ها و شارژها</span>
      </div>
      <div id="wallet-transactions-container">
        <p style="font-size: 12px; color: var(--hint); text-align: center; padding: 12px;">در حال بارگذاری تراکنش‌ها...</p>
      </div>
    </div>
  </div>

  <!-- TAB 4: PROFILE (پروفایل و تنظیمات) -->
  <div id="tab-profile" class="tab-content">
    <div class="card">
      <div class="card-header">
        <span class="card-title">👤 مشخصات کاربر</span>
      </div>
      <div style="font-size: 13px; line-height: 2;">
        <div><b>نام و نام خانوادگی:</b> <span id="prof-name">--</span></div>
        <div><b>شماره دانشجویی:</b> <span id="prof-student-id">--</span></div>
        <div><b>شناسه تلگرام:</b> <span id="prof-tg-id">--</span></div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <span class="card-title">🏛 سلف پیش‌فرض</span>
      </div>
      <p style="font-size: 12px; color: var(--hint); margin-bottom: 10px;">سلف پیش‌فرضی که غذاهای روز و رزروها برای آن ثبت می‌شوند:</p>
      <select id="profile-self-select" class="form-control" style="margin-bottom: 12px;">
        <option value="">در حال بارگذاری سلف‌ها...</option>
      </select>
      <button class="btn btn-secondary" onclick="saveDefaultSelf()">
        ذخیره سلف پیش‌فرض
      </button>
    </div>

    <div class="card" style="border-color: rgba(239, 68, 68, 0.2);">
      <button class="btn btn-danger" onclick="logout()">
        🚪 خروج از حساب کاربری
      </button>
    </div>
  </div>

  <!-- Bottom Navigation -->
  <nav class="bottom-nav">
    <div class="nav-item active" onclick="switchTab('today')" id="nav-today">
      <span class="nav-icon">🍽</span>
      <span>امروز</span>
    </div>
    <div class="nav-item" onclick="switchTab('reserve')" id="nav-reserve">
      <span class="nav-icon">📅</span>
      <span>رزرو غذا</span>
    </div>
    <div class="nav-item" onclick="switchTab('wallet')" id="nav-wallet">
      <span class="nav-icon">💰</span>
      <span>کیف پول</span>
    </div>
    <div class="nav-item" onclick="switchTab('profile')" id="nav-profile">
      <span class="nav-icon">👤</span>
      <span>پروفایل</span>
    </div>
  </nav>

  <!-- QR Code & Delivery Code Modal -->
  <div class="modal-backdrop" id="qr-modal" onclick="closeModal(event)">
    <div class="modal-box" onclick="event.stopPropagation()">
      <h3 style="font-size: 16px; font-weight: 700; margin-bottom: 4px;" id="qr-food-title">غذای روز</h3>
      <p style="font-size: 12px; color: var(--hint);">کد تحویل را مقابل اسکنر گیت سلف بگیرید</p>
      <img id="qr-modal-img" class="qr-img" src="" alt="QR Code">
      <div class="forget-code-text" id="qr-code-number">------</div>
      <button class="btn btn-secondary" onclick="closeModal()">بستن</button>
    </div>
  </div>

  <!-- Login Modal (If not logged in) -->
  <div class="modal-backdrop" id="login-modal">
    <div class="modal-box" style="max-width: 380px;">
      <h3 style="font-size: 18px; font-weight: 800; color: var(--link); margin-bottom: 6px;">ورود به سامانه صمد</h3>
      <p style="font-size: 12px; color: var(--hint); margin-bottom: 16px;">جهت مشاهده برنامه غذایی و رزرو، با حساب صمد خود وارد شوید:</p>
      
      <div class="form-group">
        <label class="form-label">شماره دانشجویی / نام کاربری</label>
        <input type="text" id="login-username" class="form-control" placeholder="مثال: 401100000" inputmode="numeric">
      </div>

      <div class="form-group">
        <label class="form-label">کلمه عبور</label>
        <input type="password" id="login-password" class="form-control" placeholder="رمز عبور سامانه صمد">
      </div>

      <div class="form-group" id="captcha-group" style="display:none;">
        <label class="form-label">کد امنیتی</label>
        <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 6px;">
          <img id="captcha-img" src="" style="height: 38px; border-radius: 8px; background: white; flex:1;" alt="کپچا">
          <button type="button" class="btn btn-secondary btn-sm" onclick="loadCaptcha()" style="height: 38px;">🔄</button>
        </div>
        <input type="text" id="login-captcha" class="form-control" placeholder="حروف تصویر بالا" inputmode="numeric">
      </div>

      <button class="btn btn-pay" id="login-submit-btn" onclick="submitLogin()" style="margin-top: 10px;">
        ورود به حساب صمد
      </button>
    </div>
  </div>

  <!-- Toast Notification -->
  <div id="toast">پیام سیستم</div>

  <script>
    // Initialize Telegram WebApp
    const tg = window.Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();
      try { tg.enableClosingConfirmation(); } catch(e){}
    }

    // Config & Global State
    const PAY_SHARIF_URL = "${payUrl}";
    let currentTelegramId = null;
    let currentUser = null;
    let currentSelfs = [];
    let currentWeekOffset = 0;
    let selectedDayIndex = 0;
    let weeklyProgramsData = [];
    let captchaData = null;

    // Detect Telegram User
    function getTelegramId() {
      if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
        return tg.initDataUnsafe.user.id;
      }
      const p = new URLSearchParams(window.location.search);
      return p.get("user_id") || p.get("id") || 0;
    }

    currentTelegramId = getTelegramId();

    function haptic(type = "light") {
      if (tg?.HapticFeedback) {
        if (type === "success" || type === "error" || type === "warning") {
          tg.HapticFeedback.notificationOccurred(type);
        } else {
          tg.HapticFeedback.impactOccurred(type);
        }
      }
    }

    function showToast(msg) {
      const t = document.getElementById("toast");
      t.innerText = msg;
      t.classList.add("show");
      setTimeout(() => t.classList.remove("show"), 2500);
    }

    function switchTab(tabId) {
      haptic("selectionChanged");
      document.querySelectorAll(".tab-content").forEach(el => el.classList.remove("active"));
      document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));
      
      const target = document.getElementById("tab-" + tabId);
      const navTarget = document.getElementById("nav-" + tabId);
      if (target) target.classList.add("active");
      if (navTarget) navTarget.classList.add("active");

      if (tabId === "reserve" && (!weeklyProgramsData || weeklyProgramsData.length === 0)) {
        loadReservablePrograms();
      } else if (tabId === "wallet") {
        loadCreditInfo();
      }
    }

    // Open direct pay.sharif.ir
    function openDirectPayment() {
      haptic("impact");
      if (tg && tg.openLink) {
        tg.openLink(PAY_SHARIF_URL);
      } else {
        window.open(PAY_SHARIF_URL, "_blank");
      }
    }

    // Open Samad Token Login
    async function openSamadTokenLogin() {
      haptic("impact");
      try {
        const res = await fetch(\`/api/credit?user_id=\${currentTelegramId}\`);
        const data = await res.json();
        if (data.loginTokenUrl) {
          if (tg && tg.openLink) tg.openLink(data.loginTokenUrl);
          else window.open(data.loginTokenUrl, "_blank");
        } else {
          openDirectPayment();
        }
      } catch {
        openDirectPayment();
      }
    }

    // API Calls
    async function initApp() {
      try {
        const res = await fetch(\`/api/me?user_id=\${currentTelegramId}\`);
        const data = await res.json();

        if (data.logged_in && data.user) {
          currentUser = data.user;
          renderUserInfo(currentUser);
          loadTodayMeals();
          loadSelfs();
        } else {
          // Open Login Modal
          document.getElementById("login-modal").classList.add("show");
          loadCaptcha();
        }
      } catch (err) {
        console.error("Init error:", err);
        showToast("خطا در برقراری ارتباط با سرور");
      }
    }

    function renderUserInfo(user) {
      const name = user.full_name || user.username || "دانشجو";
      document.getElementById("head-user-name").innerText = name;
      document.getElementById("prof-name").innerText = name;
      document.getElementById("prof-student-id").innerText = user.username || "--";
      document.getElementById("prof-tg-id").innerText = currentTelegramId || "--";

      const selfName = user.selected_self_name || "انتخاب نشده";
      document.getElementById("head-self-name").innerText = "🏛 سلف: " + selfName;

      const tomanStr = (user.credit_toman || 0).toLocaleString("fa-IR") + " ت";
      document.getElementById("head-balance-toman").innerText = tomanStr;
      document.getElementById("wallet-balance-toman").innerText = (user.credit_toman || 0).toLocaleString("fa-IR") + " تومان";
      document.getElementById("wallet-balance-rials").innerText = (user.credit_rials || 0).toLocaleString("fa-IR") + " ریال";
    }

    // Today's Meals
    async function loadTodayMeals() {
      const container = document.getElementById("today-meals-container");
      try {
        const res = await fetch(\`/api/today?user_id=\${currentTelegramId}\`);
        const data = await res.json();
        
        document.getElementById("today-date-str").innerText = data.dateJalali || "امروز";
        
        if (!data.meals || data.meals.length === 0) {
          container.innerHTML = \`<div style="text-align:center; padding:20px; color:var(--hint); font-size:13px;">برای امروز وعده‌ای رزرو نشده است 🍽</div>\`;
          return;
        }

        let html = "";
        for (const meal of data.meals) {
          const isDelivered = meal.state === 3 || meal.delivered;
          const statusBadge = isDelivered 
            ? '<span class="badge badge-success">تحویل شده ✅</span>'
            : '<span class="badge badge-info">رزرو شده ⏳</span>';

          html += \`
            <div class="meal-box">
              <div class="meal-header">
                <span class="meal-type">\${meal.mealTypeName || "وعده"} | \${meal.selfName || ""}</span>
                \${statusBadge}
              </div>
              <div class="food-title">\${meal.foodName || "غذا"}</div>
              <div class="meal-meta">
                <span>قیمت: \${(meal.price / 10).toLocaleString("fa-IR")} تومان</span>
                <button class="btn btn-secondary btn-sm" onclick="showQrModal('\${meal.foodName}', '\${meal.reserveId}')">
                  📱 بارکد تحویل
                </button>
              </div>
            </div>
          \`;
        }
        container.innerHTML = html;
      } catch (e) {
        container.innerHTML = '<div style="color:var(--danger); font-size:12px; padding:10px;">خطا در دریافت وعده‌های امروز</div>';
      }
    }

    // Weekly Programs & Reserve
    async function loadReservablePrograms() {
      const container = document.getElementById("reserve-meals-container");
      container.innerHTML = \`<div class="skeleton" style="height: 110px; margin-bottom: 10px;"></div><div class="skeleton" style="height: 110px;"></div>\`;

      const selfId = document.getElementById("reserve-self-select").value || currentUser?.selected_self_id || "";
      try {
        const res = await fetch(\`/api/programs?user_id=\${currentTelegramId}&self_id=\${selfId}&week_offset=\${currentWeekOffset}\`);
        const data = await res.json();
        weeklyProgramsData = data.days || [];
        renderDayPills();
        renderSelectedDayMeals();
      } catch {
        container.innerHTML = '<div style="color:var(--danger); font-size:12px; padding:10px;">خطا در دریافت منوی هفتگی</div>';
      }
    }

    function switchWeek(offset) {
      currentWeekOffset = offset;
      document.getElementById("week-btn-current").classList.toggle("active", offset === 0);
      document.getElementById("week-btn-next").classList.toggle("active", offset === 1);
      selectedDayIndex = 0;
      loadReservablePrograms();
    }

    function renderDayPills() {
      const container = document.getElementById("reserve-day-pills");
      if (!weeklyProgramsData || weeklyProgramsData.length === 0) {
        container.innerHTML = "";
        return;
      }

      let html = "";
      weeklyProgramsData.forEach((day, idx) => {
        const active = idx === selectedDayIndex ? "active" : "";
        html += \`
          <div class="day-pill \${active}" onclick="selectDay(\${idx})">
            <div>\${day.dayTranslated || "روز"}</div>
            <span class="day-pill-sub">\${day.dateJStr ? day.dateJStr.split('/').slice(1).join('/') : ""}</span>
          </div>
        \`;
      });
      container.innerHTML = html;
    }

    function selectDay(idx) {
      haptic("selectionChanged");
      selectedDayIndex = idx;
      renderDayPills();
      renderSelectedDayMeals();
    }

    function renderSelectedDayMeals() {
      const container = document.getElementById("reserve-meals-container");
      const currentDay = weeklyProgramsData[selectedDayIndex];
      if (!currentDay || !currentDay.meals || currentDay.meals.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--hint); font-size:13px;">منویی برای این روز یافت نشد.</div>';
        return;
      }

      let html = "";
      currentDay.meals.forEach(m => {
        html += \`<div style="font-size:13px; font-weight:800; color:var(--link); margin: 12px 0 6px;">🔹 \${m.mealTypeTitle}</div>\`;
        m.foods.forEach(f => {
          const isReserved = f.isReserved;
          const actionBtn = isReserved
            ? \`<button class="btn btn-danger btn-sm" onclick="toggleReserve(\${f.programId}, \${f.foodTypeId}, \${f.mealTypeId}, false)">لغو رزرو ✕</button>\`
            : \`<button class="btn btn-pay btn-sm" onclick="toggleReserve(\${f.programId}, \${f.foodTypeId}, \${f.mealTypeId}, true)">رزرو غذا ✓</button>\`;

          html += \`
            <div class="meal-box">
              <div class="meal-header">
                <span class="food-title">\${f.foodName}</span>
                \${isReserved ? '<span class="badge badge-success">رزرو شده</span>' : ''}
              </div>
              <div class="meal-meta" style="align-items:center;">
                <span>قیمت: \${Math.floor(f.price / 10).toLocaleString("fa-IR")} تومان</span>
                \${actionBtn}
              </div>
            </div>
          \`;
        });
      });
      container.innerHTML = html;
    }

    async function toggleReserve(programId, foodTypeId, mealTypeId, select) {
      haptic(select ? "success" : "warning");
      showToast(select ? "در حال ثبت رزرو..." : "در حال لغو رزرو...");
      try {
        const res = await fetch("/api/reserve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            telegram_id: currentTelegramId,
            program_id: programId,
            food_type_id: foodTypeId,
            meal_type_id: mealTypeId,
            selected: select
          })
        });
        const json = await res.json();
        if (json.success) {
          showToast(json.message || "عملیات با موفقیت انجام شد.");
          loadReservablePrograms();
          loadCreditInfo(false);
        } else {
          showToast("خطا: " + (json.message || "رزرو انجام نشد."));
        }
      } catch {
        showToast("خطا در برقراری ارتباط");
      }
    }

    // QR & Forget Code Modal
    async function showQrModal(foodTitle, reserveId) {
      haptic("impact");
      document.getElementById("qr-food-title").innerText = foodTitle;
      document.getElementById("qr-code-number").innerText = "⏳...";
      document.getElementById("qr-modal-img").src = "";
      document.getElementById("qr-modal").classList.add("show");

      try {
        const res = await fetch(\`/api/forget-code?user_id=\${currentTelegramId}&reserve_id=\${reserveId}\`);
        const data = await res.json();
        if (data.code) {
          document.getElementById("qr-code-number").innerText = data.code;
          document.getElementById("qr-modal-img").src = \`/api/qr?text=\${encodeURIComponent(data.code)}\`;
        } else {
          document.getElementById("qr-code-number").innerText = "ناموفق";
        }
      } catch {
        document.getElementById("qr-code-number").innerText = "خطا";
      }
    }

    function closeModal() {
      document.getElementById("qr-modal").classList.remove("show");
    }

    // Selfs
    async function loadSelfs() {
      try {
        const res = await fetch(\`/api/selfs?user_id=\${currentTelegramId}\`);
        const data = await res.json();
        currentSelfs = data.selfs || [];

        const sel1 = document.getElementById("reserve-self-select");
        const sel2 = document.getElementById("profile-self-select");
        let html = "";
        currentSelfs.forEach(s => {
          const selected = s.id === currentUser?.selected_self_id ? "selected" : "";
          html += \`<option value="\${s.id}" \${selected}>\${s.name}</option>\`;
        });
        sel1.innerHTML = html;
        sel2.innerHTML = html;
      } catch(e){}
    }

    function changeReserveSelf() {
      loadReservablePrograms();
    }

    async function saveDefaultSelf() {
      const sId = document.getElementById("profile-self-select").value;
      const sName = document.getElementById("profile-self-select").options[document.getElementById("profile-self-select").selectedIndex]?.text;
      if (!sId) return;
      haptic("impact");
      try {
        const res = await fetch("/api/select-self", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ telegram_id: currentTelegramId, self_id: parseInt(sId, 10), self_name: sName })
        });
        const data = await res.json();
        if (data.success) {
          showToast("سلف پیش‌فرض با موفقیت ثبت شد.");
          currentUser.selected_self_id = parseInt(sId, 10);
          currentUser.selected_self_name = sName;
          document.getElementById("head-self-name").innerText = "🏛 سلف: " + sName;
        }
      } catch {
        showToast("خطا در ذخیره سلف");
      }
    }

    // Wallet & Transactions
    async function loadCreditInfo(toast = false) {
      if (toast) showToast("در حال استعلام موجودی...");
      try {
        const res = await fetch(\`/api/credit?user_id=\${currentTelegramId}\`);
        const data = await res.json();
        if (data.success) {
          const tomanStr = (data.credit_toman || 0).toLocaleString("fa-IR") + " ت";
          document.getElementById("head-balance-toman").innerText = tomanStr;
          document.getElementById("wallet-balance-toman").innerText = (data.credit_toman || 0).toLocaleString("fa-IR") + " تومان";
          document.getElementById("wallet-balance-rials").innerText = (data.credit_rials || 0).toLocaleString("fa-IR") + " ریال";

          const container = document.getElementById("wallet-transactions-container");
          if (!data.transactions || data.transactions.length === 0) {
            container.innerHTML = '<p style="font-size:12px; color:var(--hint); text-align:center; padding:12px;">تراکنش اخیری ثبت نشده است.</p>';
          } else {
            let html = "";
            data.transactions.slice(0, 10).forEach(t => {
              const sign = t.amount >= 0 ? "+" : "-";
              const color = t.amount >= 0 ? "var(--success)" : "var(--danger)";
              html += \`
                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border); padding:8px 0; font-size:12px;">
                  <div>
                    <div style="font-weight:700;">\${t.description || "تراکنش"}</div>
                    <div style="color:var(--hint); font-size:10px;">\${t.date || ""}</div>
                  </div>
                  <div style="font-weight:700; color:\${color}; direction:ltr;">
                    \${sign}\${Math.floor(Math.abs(t.amount) / 10).toLocaleString("fa-IR")} تومان
                  </div>
                </div>
              \`;
            });
            container.innerHTML = html;
          }
          if (toast) showToast("موجودی به‌روز شد.");
        }
      } catch(e){}
    }

    // Login & Captcha
    async function loadCaptcha() {
      try {
        const res = await fetch("/api/captcha");
        const data = await res.json();
        captchaData = data;
        if (data.imageBase64) {
          document.getElementById("captcha-group").style.display = "block";
          document.getElementById("captcha-img").src = "data:image/png;base64," + data.imageBase64;
        }
      } catch(e){}
    }

    async function submitLogin() {
      const u = document.getElementById("login-username").value.trim();
      const p = document.getElementById("login-password").value.trim();
      const c = document.getElementById("login-captcha").value.trim();

      if (!u || !p) {
        showToast("لطفاً شماره دانشجویی و رمز عبور را وارد کنید.");
        return;
      }

      haptic("impact");
      const btn = document.getElementById("login-submit-btn");
      btn.innerText = "در حال ورود...";
      btn.disabled = true;

      try {
        const res = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            telegram_id: currentTelegramId,
            username: u,
            password: p,
            captcha_text: c,
            validation: captchaData?.validation,
            nonce: captchaData?.nonce
          })
        });
        const data = await res.json();
        if (data.success && data.user) {
          currentUser = data.user;
          document.getElementById("login-modal").classList.remove("show");
          showToast("ورود با موفقیت انجام شد 🎉");
          renderUserInfo(currentUser);
          loadTodayMeals();
          loadSelfs();
        } else {
          showToast("خطا: " + (data.message || "اطلاعات ورود اشتباه است"));
          loadCaptcha();
        }
      } catch {
        showToast("خطا در برقراری ارتباط با صمد");
      } finally {
        btn.innerText = "ورود به حساب صمد";
        btn.disabled = false;
      }
    }

    async function logout() {
      if (!confirm("آیا از خروج از حساب اطمینان دارید؟")) return;
      haptic("warning");
      try {
        await fetch("/api/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ telegram_id: currentTelegramId })
        });
        location.reload();
      } catch {
        location.reload();
      }
    }

    // Start App
    initApp();
  </script>
</body>
</html>`;
}
