# ☁️ ربات تغذیه صمد روی Cloudflare Workers (Serverless)

نسخه تمام ابری و بدون سرور (Serverless) ربات تغذیه صمد بر پایه **Cloudflare Workers**، دیتابیس ابری **Cloudflare D1** و حافظه موقت **Cloudflare KV** با پشتیبانی کامل از **تلگرام (Telegram)** و **بله (Bale)**.

---

## 🌟 ویژگی‌ها

- 💸 **کاملاً رایگان و ۲۴/۷:** بهره‌مندی از پلن رایگان Cloudflare (۱۰۰ هزار درخواست در روز بدون هزینه سرور یا VPS).
- ⚡️ **سرعت بالا و تأخیر پایین:** پردازش در لبه شبکه جهانی (Edge Network) کلادفلر.
- 📱 **پشتیبانی از تلگرام و پیام‌رسان بله:** امکان انتخاب پلتفرم یا استفاده همزمان با وب‌هوک مجزا.
- 🗄 **دیتابیس D1:** پایگاه داده ابری SQLite جهت ذخیره کاربران، نشست‌ها و سلف انتخاب شده.
- 🚀 **ثبت آسان وب‌هوک:** فعال‌سازی آنی با یک کلیک در مرورگر بدون نیاز به curl یا ابزار جانبی.

---

## 🛠 مراحل راه‌اندازی و دیپلوی

### ۱. ورود به حساب کلادفلر در ترمینال

```bash
cd cloudflare
npx wrangler login
```

### ۲. ساخت دیتابیس Cloudflare D1

```bash
npx wrangler d1 create foodbot-db
```
شناسه `database_id` تولید شده را در فایل `wrangler.toml` قرار دهید. سپس جدول‌ها را بسازید:

```bash
npx wrangler d1 execute foodbot-db --remote --file=./schema.sql
```

### ۳. ساخت فضای Cloudflare KV

```bash
npx wrangler kv namespace create foodbot-kv
```
شناسه `id` تولید شده را در `wrangler.toml` در بخش `kv_namespaces` قرار دهید.

### ۴. تنظیم توکن ربات (امنیت بالا)

توکن ربات تلگرام یا بله خود را با دستور زیر در مخزن امن Secrets کلادفلر ذخیره کنید:

```bash
npx wrangler secret put BOT_TOKEN
```

> **نکته برای تست محلی:** برای اجرای تست محلی با دستور `npm run dev`، کافی است فایل `.dev.vars.example` را به `.dev.vars` کپی کرده و توکن خود را در آن وارد کنید. (این فایل به صورت خودکار توسط گیت ایگنور شده است).

### ۵. تنظیم پلتفرم پیام‌رسان (تلگرام یا بله)

در فایل `wrangler.toml` متغیر `PLATFORM` را مشخص کنید:
```toml
[vars]
PLATFORM = "telegram" # یا "bale"
```

### ۶. دیپلوی پروژه

```bash
npx wrangler deploy
```

پس از چند ثانیه، لینک اجرای سرورلس شما نمایش داده می‌شود (مثلاً `https://foodbot.<your-subdomain>.workers.dev`).

---

## 🚀 فعال‌سازی وب‌هوک (تنها با یک کلیک!)

کافی است آدرس ورکر خود را در مرورگر باز کنید تا داشبورد فعال‌سازی ظاهر شود، یا مستقیماً به آدرس‌های زیر بروید:

- **برای تلگرام:**
  ```
  https://foodbot.<subdomain>.workers.dev/set-webhook?platform=telegram
  ```
- **برای پیام‌رسان بله:**
  ```
  https://foodbot.<subdomain>.workers.dev/set-webhook?platform=bale
  ```

### بررسی وضعیت وب‌هوک:
- تلگرام: `https://foodbot.<subdomain>.workers.dev/webhook-info?platform=telegram`
- بله: `https://foodbot.<subdomain>.workers.dev/webhook-info?platform=bale`
