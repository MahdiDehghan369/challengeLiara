// All user-facing Persian strings live here (AGENT_RULES §2). Keys are grouped by area.
// Persian text sits on its own lines so RTL does not get tangled with code.

export const fa = {
  config: {
    invalidEnv:
      'تنظیمات محیطی نامعتبر است. فایل .env را بررسی کنید.',
    missingLiaraToken:
      'حالت LIARA_MODE=live است اما LIARA_API_TOKEN تنظیم نشده. توکن API لیارا را در فایل .env قرار دهید یا LIARA_MODE=mock را انتخاب کنید.',
    missingBoxApiKey:
      'حالت LLM_MODE=live است اما BOXAPI_API_KEY تنظیم نشده. کلید BoxAPI را در فایل .env قرار دهید یا LLM_MODE=mock را انتخاب کنید.',
    invalidModels:
      'فایل config/models.json نامعتبر است.',
    modelsNotFound:
      'فایل config/models.json پیدا نشد.',
  },
  errors: {
    liaraApi:
      'درخواست به API لیارا با خطا روبه‌رو شد.',
    validation:
      'ورودی یا پاسخ نامعتبر است.',
    approvalDenied:
      'اقدام توسط کاربر تأیید نشد.',
    rateLimit:
      'تعداد درخواست‌ها از حد مجاز گذشت؛ کمی بعد دوباره تلاش کنید.',
    externalCommand:
      'اجرای دستور خارجی با خطا روبه‌رو شد.',
    llm:
      'ارتباط با مدل زبانی با خطا روبه‌رو شد.',
  },
  time: {
    second: 'ثانیه',
    minute: 'دقیقه',
    hour: 'ساعت',
    day: 'روز',
    and: ' و ',
    invalidDuration:
      'قالب مدت‌زمان نامعتبر است (نمونهٔ درست: 30s، 5m، 1h، 2d).',
  },
} as const;

export type Fa = typeof fa;
