# 🍽 FoodBot - سامانه هوشمند اتوماسیون تغذیه صمد

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.10%2B-blue.svg?logo=python&logoColor=white)](python/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020.svg?logo=cloudflare&logoColor=white)](cloudflare/)
[![Telegram](https://img.shields.io/badge/Platform-Telegram-2CA5E0.svg?logo=telegram&logoColor=white)](https://telegram.org)
[![Bale](https://img.shields.io/badge/Platform-Bale%20(بله)-00A389.svg)](https://bale.ai)

ربات چندسکویی اتوماسیون تغذیه، رزرو هوشمند غذا، مدیریت اعتبار و تولید بارکد تحویل برای سامانه یکپارچه صمد (دانشگاه صنعتی شریف و سایر دانشگاه‌ها) با دو پیاده‌سازی مستقل و پشتیبانی همزمان از **تلگرام (Telegram)** و **بله (Bale)**.

---

## 🧭 ساختار پروژه

این مخزن شامل دو پیاده‌سازی مستقل و کامل متناسب با نیازهای مختلف است:

```
FoodBot/
├── python/                  # 🐍 نسخه پایتون (Long-polling / سرور یا داکر)
│   ├── handlers/            # هندلرهای دستورات و گفتگوهای تلگرام و بله
│   ├── bot.py               # نقطه ورود اصلی ربات پایتون
│   ├── config.py            # تنظیمات و متغیرهای محیطی
│   ├── database.py          # مدیریت پایگاه‌داده SQLite
│   ├── date_helper.py       # تبدیل تقویم شمسی/میلادی و کار با روزها
│   ├── samad_client.py      # کلاینت ارتباط با وب‌سرویس صمد
│   ├── requirements.txt     # وابستگی‌های پایتون
│   ├── Dockerfile           # ایمیج داکر برای استقرار کانتینری
│   ├── docker-compose.yml   # فایل استقرار آسان با داکر کامپوز
│   ├── foodbot.service      # سرویس systemd برای لینوکس/VPS
│   ├── .env.example         # الگوی متغیرهای محیطی
│   └── README.md            # راهنمای کامل نسخه پایتون
│
├── cloudflare/              # ☁️ نسخه کلادفلر (Serverless / رایگان ۲۴ ساعته)
│   ├── src/                 # کدهای TypeScript ربات با grammY
│   │   ├── bot.ts           # منطق ربات و پیام‌ها
│   │   ├── index.ts         # نقطه ورود ورکر کلادفلر و وب‌هوک‌ها
│   │   ├── samad.ts         # کلاینت صمد در محیط ورکر
│   │   ├── db.ts            # ارتباط با Cloudflare D1
│   │   ├── kv.ts            # ارتباط با Cloudflare KV
│   │   ├── qr.ts            # تولید تصویر QR Code در Edge
│   │   ├── date.ts          # مدیریت تاریخ‌های شمسی
│   │   └── types.ts         # تعاریف داده و تایپ‌ها
│   ├── wrangler.toml        # تنظیمات ورکر، بایندینگ دیتابیس D1 و KV
│   ├── schema.sql           # ساختار جدول دیتابیس D1
│   ├── .dev.vars.example    # الگوی متغیرهای محیطی توسعه محلی
│   └── README.md            # راهنمای استقرار نسخه کلادفلر
│
├── .gitignore               # نادیده‌گرفتن فایل‌های حساس، توکن‌ها و دیتابیس‌ها
├── LICENSE                  # لایسنس MIT
└── README.md                # راهنمای جامع پروژه
```

---

## ⚖️ مقایسه دو نسخه (کدام را انتخاب کنم؟)

| ویژگی | 🐍 نسخه پایتون (`python/`) | ☁️ نسخه سرورلس کلادفلر (`cloudflare/`) |
|---|---|---|
| **هزینه میزبانی** | نیازمند VPS یا سیستم همیشه روشن | **۱۰۰٪ رایگان** (از پلن رایگان Cloudflare Workers) |
| **روش دریافت پیام** | Long-polling (یا وب‌هوک اختیاری) | **Webhook** در لبه شبکه جهانی کلادفلر |
| **دیتابیس** | SQLite محلی (`storage.db`) | دیتابیس ابری سرورلس **Cloudflare D1** |
| **کش و سشن** | فایل / حافظه رم | حافظه کلید-مقدار ابری **Cloudflare KV** |
| **پیام‌رسان‌های هدف** | تلگرام و بله (با آرگومان `--platform`) | تلگرام و بله (با متغیر `PLATFORM` یا وب‌هوک مجزا) |
| **پروکسی در ایران** | پشتیبانی داخلی از `PROXY_URL` (Socks5/HTTP) | بی‌نیاز از پروکسی (میزبانی مستقیم روی زیرساخت Cloudflare) |
| **سادگی راه‌اندازی** | نیازمند نصب Python و داکر/VPS | استقرار در ۵ دقیقه با `wrangler deploy` |

---

## 🌟 قابلیت‌ها و دستورات ربات

| دستور / دکمه | توضیح و عملکرد |
|---|---|
| **🍽 غذای امروز** (`/today`) | نمایش غذای رزرو شده امروز، نام سلف، وضعیت تحویل و **تولید خودکار کد QR / بارکد تحویل** |
| **📅 برنامه هفته بعد** (`/nextweek`) | منوی کامل هفته آینده با امکان **مقایسه همزمان همه سلف‌ها به تفکیک هر روز** |
| **📋 غذاهای رزرو مانده** (`/remaining`) | مشاهده لیست غذاهای رزرو شده تا پایان هفته با قابلیت لغو و دریافت بارکد |
| **💰 مانده اعتبار** (`/credit`) | نمایش موجودی کیف پول تغذیه (ریال و تومان) و ریز تراکنش‌های اخیر |
| **💳 افزایش اعتبار** (`/charge`) | تولید توکن ورود سریع و لینک مستقیم پرداخت شتابی بدون نیاز به وارد کردن مجدد پسورد |
| **🛒 رزرو و خرید غذا** (`/buy`) | خرید تعاملی از منوی هفته آینده با دکمه‌های اینلاین و خرید از فروش روزانه |
| **⚙️ انتخاب سلف** (`/self`) | تغییر سالن غذاخوری پیش‌فرض کاربر (مرکزی، خوابگاه، خلدبرین و...) |
| **👤 حساب کاربری** (`/profile`) | مشخصات دانشجو، رشته، شماره دانشجویی و سلف فعال |
| **🔐 ورود و خروج** (`/login`, `/logout`) | ورود امن چندکاربره با تفکیک نشست و رمزهای عبور |

---

## 🚀 شروع سریع

### ۱. راه‌اندازی نسخه پایتون (Python)

```bash
cd python

# ایجاد محیط مجازی و نصب وابستگی‌ها
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# تنظیم فایل پیکربندی
cp .env.example .env
# مقادیر BOT_TOKEN و پلتفرم را در فایل .env تنظیم کنید

# اجرا برای تلگرام
python bot.py --platform telegram

# اجرا برای پیام‌رسان بله
python bot.py --platform bale
```
👉 جزئیات بیشتر، داکر و سرویس systemd در [راهنمای نسخه پایتون](python/README.md).

---

### ۲. راه‌اندازی نسخه کلادفلر (Cloudflare Workers)

```bash
cd cloudflare

# نصب وابستگی‌ها
npm install

# ساخت دیتابیس D1 و سطل KV
npx wrangler d1 create foodbot-db
npx wrangler d1 execute foodbot-db --remote --file=./schema.sql
npx wrangler kv namespace create foodbot-kv

# ثبت ایمن توکن ربات
npx wrangler secret put BOT_TOKEN

# استقرار روی شبکه کلادفلر
npx wrangler deploy
```

پس از استقرار، کافی است لینک زیر را در مرورگر باز کنید تا وب‌هوک در تلگرام یا بله ثبت شود:
- برای تلگرام: `https://<your-worker>.workers.dev/set-webhook?platform=telegram`
- برای بله: `https://<your-worker>.workers.dev/set-webhook?platform=bale`

👉 راهنمای گام‌به‌گام و مصور در [راهنمای نسخه کلادفلر](cloudflare/README.md).

---

## 📱 نحوه اتصال به پیام‌رسان بله (Bale)

پیام‌رسان بله از پروتکلی سازگار با تلگرام برای ربات‌ها استفاده می‌کند:
- آدرس وب‌سرویس ربات‌های بله: `https://tapi.bale.ai/bot<TOKEN>/<METHOD>`
- توکن ربات را می‌توانید مستقیماً از **[@BotFather](https://ble.ir/botfather)** در پیام‌رسان بله دریافت کنید.
- برای نسخه پایتون، کافی است مقدار `PLATFORM=bale` در `.env` قرار گیرد یا آرگومان `--platform bale` پاس داده شود.
- برای نسخه کلادفلر، وب‌هوک با اندپوینت `/set-webhook?platform=bale` فعال می‌شود.

---

## 🔒 امنیت و حریم خصوصی

- هیچ‌گونه توکن، رمز عبور یا فایل پایگاه‌داده در مخزن گیت ذخیره نمی‌شود.
- فایل‌های حساس (`.env`، `storage.db`، `.dev.vars`، پوشه `venv` و `node_modules`) در `.gitignore` به دقت فیلتر شده‌اند.
- پس از دریافت رمز عبور در مرحله لاگین، پیام حاوی پسورد کاربر بلافاصله حذف می‌گردد.

---

## 📄 لایسنس

این پروژه تحت مجوز متن‌باز [MIT License](LICENSE) منتشر شده است.
