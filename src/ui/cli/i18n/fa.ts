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
  liaraHttp: {
    badRequest:
      'ورودی ارسال‌شده به لیارا نامعتبر است.',
    unauthorized:
      'توکن لیارا نامعتبر یا منقضی است.',
    forbidden:
      'دسترسی به این منبع در لیارا مجاز نیست.',
    notFound:
      'اپ یا منبع موردنظر در لیارا پیدا نشد.',
    conflict:
      'تداخل در لیارا: این منبع از قبل وجود دارد یا در وضعیت فعلی قابل تغییر نیست.',
    rateLimited:
      'لیارا محدودیت نرخ درخواست اعمال کرده است؛ کمی بعد دوباره تلاش کنید.',
    server:
      'سرویس لیارا با خطای داخلی پاسخ داد؛ کمی بعد دوباره تلاش کنید.',
    unexpected:
      'لیارا پاسخ غیرمنتظره‌ای داد.',
    timeout:
      'پاسخی از لیارا در زمان مقرر دریافت نشد.',
    network:
      'اتصال به لیارا برقرار نشد؛ اینترنت یا فیلترشکن را بررسی کنید.',
    invalidResponse:
      'پاسخ لیارا با قالب مورد انتظار نمی‌خواند.',
  },
  apps: {
    notFound: (name: string) =>
      `اپی با نام «${name}» در حساب لیارا پیدا نشد.`,
    notFoundSuggest: (name: string, suggestion: string) =>
      `اپی با نام «${name}» پیدا نشد. منظورتان «${suggestion}» بود؟`,
    nameTaken: (name: string) =>
      `نام «${name}» قبلاً گرفته شده است؛ نام دیگری انتخاب کنید.`,
  },
  wait: {
    timeout:
      'عملیات در زمان مقرر به وضعیت مورد انتظار نرسید.',
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
