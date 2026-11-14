# 🐍 ربات تغذیه صمد (نسخه پایتون) - FoodBot Python

نسخه کامل و قدرتمند ربات تغذیه صمد با زبان پایتون (Python 3.10+) و کتابخانه `python-telegram-bot` به روش Polling، با پشتیبانی همزمان از **تلگرام (Telegram)** و پیام‌رسان **بله (Bale)**.

---

## 🌟 ویژگی‌ها

- 🚀 **پشتیبانی دوگانه از تلگرام و بله:** با ساختار مشترک و تغییر سریع پلتفرم از طریق تنظیمات یا آرگومان خط فرمان.
- 🔐 **احراز هویت چندکاربره:** ذخیره‌سازی نشست‌ها و توکن‌ها در دیتابیس محلی SQLite با قابلیت خروج امن.
- 🍽 **دریافت غذای روز و بارکد:** تولید فوری کد فراموشی/کد تحویل به همراه تصویر QR Code جهت ارائه به دستگاه‌های سلف.
- 📅 **برنامه غذایی هفته بعد و مقایسه سلف‌ها:** مشاهده منو و مقایسه همه سلف‌ها (مرکزی، کلانا، کاله، یونی‌فود و...).
- 🛒 **خرید و لغو تعاملی غذا:** رزرو هفتگی یا روزانه با دکمه‌های شیشه‌ای اینلاین.
- 💰 **کیف پول و افزایش اعتبار:** نمایش مانده حساب، **اتصال مستقیم به درگاه pay.sharif.ir** و ورود سریع با توکن به صمد.
- 📱 **پشتیبانی از مینی‌اپ وب تلگرام:** اجرای سریع با دستور `/app` و دکمه Menu Button در صورت تنظیم `MINIAPP_URL`.
- 🐳 **پشتیبانی کامل از داکر:** دارای `Dockerfile` سبک و `docker-compose.yml`.

---

## 🛠 نیازمندی‌ها و راه‌اندازی

### ۱. ساخت محیط مجازی و نصب پکیج‌ها:

```bash
cd python
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### ۲. تنظیم متغیرهای محیطی (`.env`):

فایل `.env.example` را به `.env` کپی کرده و اطلاعات خود را وارد نمایید:

```bash
cp .env.example .env
```

نمونه محتوای `.env`:

```env
# انتخاب پلتفرم: telegram یا bale
PLATFORM=telegram

# توکن ربات (از BotFather در تلگرام یا بله)
BOT_TOKEN=your_bot_token_here

# آدرس سامانه صمد دانشگاه (پیش‌فرض: شریف)
SAMAD_BASE_URL=https://setad.dining.sharif.edu/
SAMAD_BASIC_AUTH=Basic c2FtYWQtbW9iaWxlOnNhbWFkLW1vYmlsZS1zZWNyZXQ=

# دیتابیس محلی
DATABASE_PATH=storage.db

# در صورت عدم تایید گواهی SSL داخلی دانشگاه:
VERIFY_SSL=False

# پروکسی برای اتصال به تلگرام در ایران (برای بله نیازی نیست):
PROXY_URL=socks5://127.0.0.1:1080

# درگاه متمرکز پرداخت شریف (متصل به حساب صمد):
PAY_SHARIF_URL=https://pay.sharif.ir

# آدرس مینی‌اپ وب تلگرام (اختیاری):
MINIAPP_URL=https://foodbot.<your-subdomain>.workers.dev/app
```

---

## 🚀 نحوه اجرا

### اجرای مستقیم با پلتفرم پیش‌فرض فایل `.env`:
```bash
python bot.py
```

### اجرای مستقیم برای تلگرام:
```bash
python bot.py --platform telegram
```

### اجرای مستقیم برای بله (Bale):
```bash
python bot.py --platform bale
```

> **نکته برای بله:** پیام‌رسان بله بدون فیلتر در داخل کشور در دسترس است؛ بنابراین در حالت بله معمولاً نیازی به تنظیم `PROXY_URL` نیست. ساختار API بله مشابه تلگرام بوده و آدرس پایه آن به صورت خودکار روی `https://tapi.bale.ai/bot` تنظیم می‌شود.

---

## 🐳 اجرای با Docker

```bash
# بیلد و اجرا در پس‌زمینه
docker compose up -d --build

# مشاهده لاگ‌ها
docker compose logs -f
```

---

## ⚙️ اجرای به عنوان سرویس Systemd (لینوکس / VPS)

فایل `foodbot.service` را در مسیر `/etc/systemd/system/foodbot.service` کپی کرده، مسیرهای اجرایی را متناسب با سرور خود اصلاح کنید و سپس:

```bash
sudo systemctl daemon-reload
sudo systemctl enable foodbot
sudo systemctl start foodbot
sudo systemctl status foodbot
```
