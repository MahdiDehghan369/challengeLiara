/**
 * Limits catalog (T10.4). Every item says what is not possible, why, and what Siavash does instead.
 * The same data feeds `siavash limits`, the `get_limits` tool, the web panel and docs/API_LIMITS.md.
 */

export type LimitCategory = 'human-only' | 'api-gap' | 'unknown-behavior' | 'rate-limit' | 'llm' | 'agent';

export interface LimitItem {
  id: string;
  category: LimitCategory;
  whatFa: string;
  whyFa: string;
  alternativeFa: string;
  /** Short English line for LLM tool answers. */
  en: string;
}

export const CATEGORY_FA: Record<LimitCategory, string> = {
  'human-only': 'فقط با دست شما',
  'api-gap': 'شکاف‌های API لیارا',
  'unknown-behavior': 'رفتارهای نامعلوم API',
  'rate-limit': 'محدودیت تعداد درخواست',
  llm: 'محدودیت‌های مدل زبانی',
  agent: 'محدودیت‌های خود عامل',
};

export const LIMITS: readonly LimitItem[] = [
  // (a) human-only
  {
    id: 'topup',
    category: 'human-only',
    whatFa: 'شارژ حساب لیارا',
    whyFa: 'پرداخت از درگاه بانکی و با حضور صاحب حساب انجام می‌شود؛ API پرداخت ندارد.',
    alternativeFa: 'سیاوش موجودی را قبل از ساخت اپ یا تغییر پلن می‌خواند، هزینهٔ ماهانه را حساب می‌کند و لینک شارژ پنل را می‌دهد؛ بعد از شارژ دوباره موجودی را چک می‌کند و ادامه می‌دهد.',
    en: 'Topping up the balance is human-only (bank gateway). The agent checks the balance and cost first and waits for the top-up.',
  },
  {
    id: 'buy-domain',
    category: 'human-only',
    whatFa: 'خرید دامنه (مثلاً در ایرنیک)',
    whyFa: 'ثبت دامنه نزد ثبت‌کننده و با هویت مالک انجام می‌شود.',
    alternativeFa: 'سیاوش دامنه را به اپ وصل می‌کند و دقیقاً می‌گوید در پنل ثبت‌کننده چه رکوردی بسازید.',
    en: 'Buying a domain is human-only. The agent attaches it and tells the user which records to create.',
  },
  {
    id: 'registrar-dns',
    category: 'human-only',
    whatFa: 'تغییر NS یا رکوردهای DNS نزد ثبت‌کننده',
    whyFa: 'به حساب ایرنیک یا ثبت‌کنندهٔ دیگر دسترسی نداریم.',
    alternativeFa: 'مقدار دقیق رکورد (CNAME/A یا NS لیارا) نمایش داده می‌شود و سیاوش با DNS lookup بررسی می‌کند که تغییر شما اعمال شده یا نه، سپس SSL را فعال می‌کند.',
    en: 'Registrar DNS changes are human-only. The agent shows the exact record and verifies it with DNS lookups before enabling SSL.',
  },
  // (b) API gaps
  {
    id: 'app-details',
    category: 'api-gap',
    whatFa: 'جزئیات کامل اپ با یک درخواست مستند',
    whyFa: 'endpoint جزئیات اپ فقط در spec آمده و در مستندات رسمی تأیید نشده است.',
    alternativeFa: 'فهرست اپ‌ها خوانده و فیلتر می‌شود (list + filter) با کش ۵ ثانیه‌ای.',
    en: 'No documented app-details endpoint: list + filter is used.',
  },
  {
    id: 'releases',
    category: 'api-gap',
    whatFa: 'فهرست و وضعیت releaseها',
    whyFa: 'endpoint فهرست release مستند نیست.',
    alternativeFa: 'هر deploy در دفتر محلی (ledger) ثبت می‌شود و وضعیت از رویدادها، لاگ build و وضعیت اپ استنتاج می‌شود.',
    en: 'No documented release list: a local deployment ledger plus events/logs is used.',
  },
  {
    id: 'rollback',
    category: 'api-gap',
    whatFa: 'rollback یک‌کلیکی',
    whyFa: 'API عملیات rollback ندارد.',
    alternativeFa: 'سیاوش آخرین نسخهٔ سالم را از ledger پیدا می‌کند و همان commit/سورس را دوباره deploy می‌کند (با تأیید شما).',
    en: 'No rollback API: the agent redeploys the last healthy source from its ledger (with approval).',
  },
  {
    id: 'env-read',
    category: 'api-gap',
    whatFa: 'خواندن متغیرهای محیطی از API',
    whyFa: 'API فقط نوشتن env را مستند کرده است.',
    alternativeFa: 'از `liara env:list` استفاده می‌شود؛ مقدارها هرگز چاپ یا به LLM فرستاده نمی‌شوند و فقط نام‌ها نمایش داده می‌شوند.',
    en: 'Env vars are read via the Liara CLI; values are never shown or sent to the LLM.',
  },
  {
    id: 'plan-catalog',
    category: 'api-gap',
    whatFa: 'کاتالوگ قیمت پلن‌ها',
    whyFa: 'API مستقل قیمت پلن ندارد.',
    alternativeFa: 'از `liara plan:list` خوانده می‌شود و اگر در دسترس نبود از کاتالوگ محلی با تاریخ به‌روزرسانی استفاده و صریحاً اعلام می‌شود.',
    en: 'Plan prices come from `liara plan:list` or a dated local catalog.',
  },
  {
    id: 'apm',
    category: 'api-gap',
    whatFa: 'زمان پاسخ هر route و trace درخواست‌ها',
    whyFa: 'لیارا فقط CPU، RAM، شبکه و دیسک را در API می‌دهد.',
    alternativeFa: 'سیاوش خودش چند درخواست HTTP به آدرس اپ می‌زند و زمان پاسخ و کد وضعیت را می‌سنجد.',
    en: 'No APM/latency API: the agent probes the app URL itself.',
  },
  // (c) unknown behaviour
  {
    id: 'env-semantics',
    category: 'unknown-behavior',
    whatFa: 'جایگزینی یا ادغام envها در update-envs',
    whyFa: 'مستندات مشخص نمی‌کند ارسال لیست جدید، envهای قبلی را پاک می‌کند یا نه.',
    alternativeFa: 'سیاوش همیشه همهٔ envها را می‌خواند، ادغام می‌کند و کل لیست را می‌فرستد؛ حذف با `env:unset` انجام می‌شود تا هیچ متغیری گم نشود.',
    en: 'update-envs replace/merge semantics unknown: read-merge-write is used so no variable is lost.',
  },
  {
    id: 'restart-confirmation',
    category: 'unknown-behavior',
    whatFa: 'پاسخ فوری API به restart یا scale',
    whyFa: 'API فقط «پذیرفته شد» برمی‌گرداند و پایان کار را اعلام نمی‌کند.',
    alternativeFa: 'بعد از هر اقدام، وضعیت واقعی اپ و آدرس آن چند بار بررسی می‌شود تا نتیجه با شاهد تأیید شود.',
    en: 'Mutations return only "accepted": the agent polls real state and probes the URL to confirm.',
  },
  {
    id: 'metric-units',
    category: 'unknown-behavior',
    whatFa: 'واحد دقیق برخی متریک‌ها',
    whyFa: 'واحد CPU و حافظه در پاسخ API ذکر نشده است.',
    alternativeFa: 'مقدارها نسبت به سقف پلن مقایسه می‌شوند و اگر واحد نامعلوم بود، در گزارش ذکر می‌شود.',
    en: 'Some metric units are not documented: values are compared to plan limits and marked when unsure.',
  },
  // (d) rate limits
  {
    id: 'rate-limit',
    category: 'rate-limit',
    whatFa: 'تعداد نامحدود درخواست به API',
    whyFa: 'لیارا روی API محدودیت نرخ دارد (پاسخ 429).',
    alternativeFa: 'درخواست‌های GET با backoff و Retry-After تکرار می‌شوند، بودجهٔ درخواست در هر جلسه کنترل می‌شود و حلقه‌های بی‌پیشرفت متوقف می‌شوند.',
    en: 'Liara rate-limits the API (429): retries with backoff, per-session request budget and a loop breaker.',
  },
  // (e) LLM
  {
    id: 'llm-hallucination',
    category: 'llm',
    whatFa: 'قطعیت در پاسخ مدل زبانی',
    whyFa: 'مدل ممکن است حدس اشتباه بزند.',
    alternativeFa: 'هر فرضیهٔ علت باید به شاهد مشخص (لاگ، متریک، رویداد) ارجاع دهد وگرنه حذف می‌شود؛ الگوهای شناخته‌شده بدون LLM تشخیص داده می‌شوند.',
    en: 'LLM output can be wrong: every hypothesis must cite evidence; known patterns are matched without the LLM.',
  },
  {
    id: 'llm-secrets',
    category: 'llm',
    whatFa: 'ارسال کامل لاگ‌ها به مدل',
    whyFa: 'لاگ ممکن است رمز یا توکن داشته باشد.',
    alternativeFa: 'همه‌چیز قبل از ارسال redact می‌شود و فقط خوشه‌های خطای ناشناخته (نه همهٔ لاگ) فرستاده می‌شوند.',
    en: 'Logs are redacted and only unmatched error clusters reach the LLM.',
  },
  // (f) agent
  {
    id: 'no-24-7',
    category: 'agent',
    whatFa: 'پایش شبانه‌روزی',
    whyFa: 'سیاوش یک دستیار درخواستی است، نه سرویس مانیتورینگ همیشه‌روشن.',
    alternativeFa: 'بررسی سلامت به درخواست شما یا برای مدت کوتاه انجام می‌شود؛ برای پایش دائمی، اعلان‌های لیارا یا یک cron که `siavash health` را اجرا کند پیشنهاد می‌شود.',
    en: 'No 24/7 monitoring: checks run on request; use Liara alerts or a cron running `siavash health`.',
  },
  {
    id: 'probabilistic',
    category: 'agent',
    whatFa: 'تشخیص قطعی علت',
    whyFa: 'علت‌ها از روی شواهد موجود استنتاج می‌شوند.',
    alternativeFa: 'علت‌ها با درصد اطمینان و شاهد رتبه‌بندی می‌شوند و بعد از هر اصلاح، نتیجه با مقایسهٔ قبل/بعد بررسی می‌شود.',
    en: 'Diagnoses are probabilistic: ranked with confidence and evidence, and every fix is verified before/after.',
  },
  {
    id: 'sensitive-approval',
    category: 'agent',
    whatFa: 'اجرای خودکار عملیات حساس',
    whyFa: 'عمداً: ری‌استارت، تغییر پلن، env و حذف پیامد دارند.',
    alternativeFa: 'عملیات R0 (خواندنی) خودکار است؛ R1 تأیید، R2 تأیید با نمایش هزینه/اثر و R3 تأیید با تایپ نام اپ لازم دارد. همه در audit ثبت می‌شوند.',
    en: 'R1+ actions always need user approval (R3 needs the app name typed); everything is audited.',
  },
];

export function limitsByCategory(): Array<{ category: LimitCategory; titleFa: string; items: LimitItem[] }> {
  const order = Object.keys(CATEGORY_FA) as LimitCategory[];
  return order.map((category) => ({ category, titleFa: CATEGORY_FA[category], items: LIMITS.filter((l) => l.category === category) }));
}

export function findLimit(id: string): LimitItem | undefined {
  return LIMITS.find((l) => l.id === id);
}

/** Compact form for the `get_limits` tool. */
export function limitsForLlm() {
  return {
    limits: LIMITS.map((l) => ({ id: l.id, category: l.category, limit: l.en, alternativeFa: l.alternativeFa })),
    note: 'Open API questions are tracked in docs/OPEN_QUESTIONS.md; behaviour marked unknown is handled conservatively.',
  };
}
