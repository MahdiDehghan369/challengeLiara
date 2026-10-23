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
    budget:
      'سقف مصرف این جلسه پر شد؛ کار Agent متوقف شد.',
  },
  agent: {
    maxSteps: (n: number) => `Agent بعد از ${n} گام به نتیجهٔ نهایی نرسید و متوقف شد؛ لطفاً درخواست را دقیق‌تر بگویید.`,
    noAnswer: 'مدل زبانی پاسخی برنگرداند.',
    cancelled: 'به درخواست شما لغو شد.',
  },
  tools: {
    unknownTool: (name: string) => `ابزار «${name}» وجود ندارد.`,
    invalidInput: (name: string) => `ورودی ابزار «${name}» نامعتبر است.`,
    readTitle: (name: string) => `اجرای ابزار فقط‌خواندنی «${name}»`,
    readImpact: 'فقط اطلاعات خوانده می‌شود؛ چیزی تغییر نمی‌کند.',
    noRollback: 'نیازی به برگشت نیست.',
    defaultReason: 'درخواست Agent',
    read: {
      listApps: 'فهرست اپ‌های حساب لیارا',
      getApp: 'جزئیات یک اپ',
      getBilling: 'موجودی و تنظیمات صورت‌حساب',
      listPlans: 'فهرست پلن‌ها و قیمت‌ها',
      metricsSummary: 'خلاصهٔ مصرف CPU، حافظه و دیسک',
      metricsSeries: 'سری زمانی یک متریک',
      getLogs: 'لاگ‌های اخیر اپ (خلاصه‌شده)',
      getEvents: 'رویدادهای اپ',
      listDeployments: 'سابقهٔ deployها',
      listDomains: 'دامنه‌های اپ',
      listDisks: 'دیسک‌ها و درصد مصرف',
      listBackups: 'backupهای یک دیسک',
      listEnv: 'متغیرهای محیطی (ماسک‌شده)',
      listDatabases: 'دیتابیس‌ها',
      getLimits: 'محدودیت‌های شناخته‌شدهٔ Agent و API',
    },
  },
  llm: {
    allModelsFailed: 'هیچ‌کدام از مدل‌های زبانی این نقش پاسخ ندادند؛ کمی بعد دوباره تلاش کنید.',
    toolsNeedJsonProtocol: 'مدل این نقش از فراخوانی مستقیم ابزار پشتیبانی نمی‌کند؛ باید از پروتکل JSON استفاده شود.',
    noMockRule: 'برای این درخواست در MockLlm قانونی تعریف نشده است.',
    badJsonReply: 'مدل زبانی دو بار پاسخ نامعتبر داد (JSON قابل‌فهم نبود)؛ درخواست را دوباره امتحان کنید.',
    badStructured: 'خروجی مدل زبانی دو بار با قالب مورد انتظار جور نبود.',
    promptNotFound: (name: string) => `قالب پرامپت «${name}» پیدا نشد.`,
  },
  friendly: {
    whatLabel: 'چه اتفاقی افتاد:',
    doLabel: 'چه کار کنم:',
    techLabel: 'جزئیات فنی:',
    verboseHint: 'برای دیدن جزئیات فنی، دستور را با --verbose اجرا کنید.',
    tokenDo: 'یک توکن API تازه از کنسول لیارا بگیرید و مقدار LIARA_API_TOKEN را در فایل .env به‌روز کنید.',
    envKeyDo: (key: string) => `مقدار ${key} را در فایل .env قرار دهید (نه در .env.example) و دوباره اجرا کنید.`,
    networkWhat: 'ارتباط با لیارا برقرار نشد (شبکه قطع است یا پاسخی در زمان مقرر نیامد).',
    networkDo: 'اتصال اینترنت و تنظیمات proxy را بررسی کنید و چند لحظه بعد دوباره تلاش کنید.',
    rateDo: (wait: string) => `حدود ${wait} صبر کنید و دوباره تلاش کنید.`,
    rateDoUnknown: 'کمی صبر کنید و دوباره تلاش کنید.',
    cliMissingWhat: 'ابزار خط فرمان لیارا (Liara CLI) نصب نیست.',
    cliMissingDo: 'Liara CLI را با دستور زیر نصب کنید و دوباره تلاش کنید:',
    balanceWhat: 'موجودی حساب لیارا برای این کار کافی نیست.',
    balanceDo: 'حساب لیارا را از کنسول شارژ کنید و دوباره تلاش کنید.',
    conflictDo: 'یک نام دیگر انتخاب کنید یا منبع موجود را بررسی کنید.',
    timeoutWhat: 'عملیات در زمان مقرر تمام نشد.',
    timeoutDo: 'وضعیت و لاگ‌های اپ را بررسی کنید؛ ممکن است عملیات هنوز در جریان باشد:',
    notFoundSuggestDo: (name: string) => `اگر منظورتان «${name}» است، دستور را با همین نام تکرار کنید.`,
    notFoundDo: 'فهرست اپ‌ها را ببینید و نام درست را وارد کنید:',
    deniedDo: 'کاری لازم نیست؛ هیچ تغییری اعمال نشد.',
    budgetDo: 'درخواست را محدودتر کنید یا یک جلسهٔ تازه شروع کنید.',
    genericDo: 'دوباره تلاش کنید؛ اگر تکرار شد، با --verbose اجرا کنید و جزئیات را گزارش دهید.',
    unexpectedWhat: 'یک خطای پیش‌بینی‌نشده رخ داد.',
    /** Persian keyword Liara may use in low-balance error messages (matched, not shown). */
    balanceKeyword: 'موجودی',
  },
  budget: {
    soft: (what: string, value: number, limit: number) =>
      `هشدار: ${what} به ${value} رسید (حد نرم: ${limit}).`,
    hard: (what: string, value: number, limit: number) =>
      `${what} به ${value} رسید و از حد سخت (${limit}) گذشت؛ کار Agent متوقف شد.`,
    counters: {
      liaraPerMinute: 'تعداد درخواست‌های لیارا در دقیقه',
      llmRequests: 'تعداد درخواست‌های مدل زبانی در این جلسه',
      llmTokens: 'تعداد توکن‌های مدل زبانی در این جلسه',
    },
    noProgress: (n: number) =>
      `Agent ${n} گام بدون پیشرفت برداشت؛ برای جلوگیری از حلقهٔ بی‌پایان متوقف شد.`,
    repeatedTool: (tool: string, n: number) =>
      `ابزار «${tool}» با پارامترهای یکسان ${n} بار تکرار شد؛ برای جلوگیری از حلقهٔ بی‌پایان متوقف شد.`,
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
  disks: {
    inUse: (disk: string) =>
      `دیسک «${disk}» در حال استفاده است و فعلاً حذف نمی‌شود.`,
  },
  opsDelete: {
    irreversible: 'این کار برگشت‌ناپذیر است.',
    noRollback: 'راه برگشتی وجود ندارد؛ فقط از backup می‌توان بازیابی کرد.',
    dependents: 'منابع وابسته که از بین می‌روند یا از کار می‌افتند:',
    noDependents: 'منبع وابسته‌ای پیدا نشد.',
    diskLine: (disk: string, mount?: string) => (mount ? `دیسک «${disk}» (mount در ${mount})` : `دیسک «${disk}»`),
    ftpLine: (user: string, disk: string) => `دسترسی FTP «${user}» روی دیسک «${disk}»`,
    domainLine: (domain: string) => `دامنهٔ «${domain}»`,
    dbNotDeleted: 'دیتابیس‌ها جدا هستند و با حذف اپ پاک نمی‌شوند.',
    suggestBackup: 'پیشنهاد: پیش از حذف، از داده‌ها backup بگیرید.',
    suggestDiskBackups: (disks: string) => `پیشنهاد: پیش از حذف، از این دیسک‌ها backup بگیرید: ${disks}`,
    domainImpact: 'دامنه و گواهی SSL آن از لیارا حذف می‌شود و ترافیک این دامنه به اپ نمی‌رسد.',
    dbImpact: 'همهٔ داده‌های دیتابیس پاک می‌شود و اپ‌هایی که به آن وصل‌اند خطا می‌گیرند.',
    ftpImpact: 'این دسترسی FTP دیگر کار نمی‌کند؛ فایل‌های دیسک حذف نمی‌شوند.',
    titleApp: (app: string) => `حذف کامل اپ «${app}»`,
    titleDisk: (disk: string, app: string) => `حذف دیسک «${disk}» از اپ «${app}»`,
    titleDomain: (domain: string) => `حذف دامنهٔ «${domain}»`,
    titleDb: (db: string) => `حذف دیتابیس «${db}»`,
    titleFtp: (user: string) => `حذف دسترسی FTP «${user}»`,
    defaultReason: 'درخواست کاربر',
  },
  opsSettings: {
    on: 'فعال',
    off: 'غیرفعال',
    title: (setting: string, state: string) => `${state} کردن ${setting}`,
    names: {
      zeroDowntime: 'استقرار بدون قطعی (zero-downtime)',
      defaultSubdomain: 'زیردامنهٔ پیش‌فرض لیارا',
      fixedIp: 'IP ثابت خروجی',
      readOnly: 'فایل‌سیستم فقط‌خواندنی',
    },
    impact: {
      zeroDowntimeOn: 'در deployهای بعدی، نسخهٔ جدید پیش از خاموش‌شدن نسخهٔ قبلی بالا می‌آید و کاربران قطعی نمی‌بینند.',
      zeroDowntimeOff: 'در deployهای بعدی، اپ برای چند ثانیه تا بالا آمدن نسخهٔ جدید در دسترس نیست.',
      defaultSubdomainOn: 'اپ دوباره از آدرس پیش‌فرض لیارا (liara.run) در دسترس می‌شود.',
      defaultSubdomainOff: 'آدرس پیش‌فرض لیارا (liara.run) دیگر کار نمی‌کند و اپ فقط از دامنه‌های متصل در دسترس است.',
      fixedIpOn: 'اپ برای درخواست‌های خروجی یک IP ثابت می‌گیرد (مثلاً برای whitelist سرویس‌های دیگر). این قابلیت هزینهٔ ماهانه دارد.',
      fixedIpOff: 'IP ثابت خروجی آزاد می‌شود و سرویس‌هایی که آن را whitelist کرده‌اند ممکن است دسترسی را رد کنند.',
      readOnlyOn: 'فایل‌سیستم اصلی کانتینر فقط‌خواندنی می‌شود؛ نوشتن فقط روی دیسک‌های متصل ممکن است. امنیت بیشتر می‌شود.',
      readOnlyOff: 'فایل‌سیستم کانتینر دوباره قابل نوشتن می‌شود.',
    },
    noCustomDomainWarning: 'هشدار: این اپ هیچ دامنهٔ سفارشی ندارد؛ با این کار اپ از دسترس خارج می‌شود.',
    readOnlyWritesWarning: (where: string) =>
      `هشدار: این اپ روی ${where} می‌نویسد؛ با فایل‌سیستم فقط‌خواندنی نوشتن خارج از دیسک‌های متصل خطا می‌دهد.`,
    rollback: (state: string) => `با ${state} کردن دوبارهٔ همین تنظیم برمی‌گردد.`,
    defaultReason: 'درخواست کاربر',
  },
  opsDisks: {
    usageHigh: (disk: string, pct: number) =>
      `مصرف دیسک «${disk}» به ${pct}٪ رسیده است؛ فضا را آزاد کنید یا حجم دیسک را افزایش دهید.`,
    suggestBackup: (disk: string) =>
      `پیشنهاد: پیش از این کار از دیسک «${disk}» backup بگیرید.`,
    createBackupTitle: (disk: string) => `گرفتن backup از دیسک «${disk}»`,
    createBackupImpact: 'یک نسخهٔ پشتیبان از محتوای فعلی دیسک ساخته می‌شود؛ اپ متوقف نمی‌شود.',
    createBackupRollback: 'نیازی به برگشت نیست؛ backup را می‌توان بعداً حذف کرد.',
    downloadTitle: (backup: string) => `ساخت لینک دانلود backup «${backup}»`,
    downloadImpact: 'یک لینک موقت دانلود ساخته می‌شود؛ لینک فقط به شما نمایش داده می‌شود.',
    downloadRollback: 'لینک پس از مدتی منقضی می‌شود.',
    resizeTitle: (disk: string, size: string) => `تغییر حجم دیسک «${disk}» به ${size} گیگابایت`,
    resizeImpact: 'حجم دیسک تغییر می‌کند و ممکن است هزینهٔ ماهانه بیشتر شود.',
    resizeRollback: 'کوچک‌کردن دیسک ممکن است ممکن نباشد؛ پیش از آن backup بگیرید.',
    createDiskTitle: (disk: string, size: string) => `ساخت دیسک «${disk}» با حجم ${size} گیگابایت`,
    createDiskImpact: 'یک دیسک جدید ساخته می‌شود و هزینهٔ ماهانه دارد؛ برای استفاده باید mount شود.',
    createDiskRollback: 'دیسک را می‌توان حذف کرد (عمل R3).',
    createFtpTitle: (disk: string, user: string) => `ساخت دسترسی FTP «${user}» برای دیسک «${disk}»`,
    createFtpImpact: (readOnly: boolean) =>
      readOnly
        ? 'یک دسترسی FTP فقط‌خواندنی ساخته می‌شود؛ رمز آن فقط یک بار نمایش داده می‌شود.'
        : 'یک دسترسی FTP با امکان نوشتن ساخته می‌شود؛ هر کس رمز را داشته باشد می‌تواند فایل‌ها را تغییر دهد. رمز فقط یک بار نمایش داده می‌شود.',
    createFtpRollback: 'دسترسی FTP را می‌توان حذف کرد.',
    defaultReason: 'درخواست کاربر',
  },
  cli: {
    notInstalled:
      'Liara CLI پیدا نشد. با دستور «npm i -g @liara/cli» نصبش کنید.',
    usingNpx:
      'Liara CLI نصب نیست؛ فعلاً از npx استفاده می‌شود (کندتر). برای سرعت بیشتر: npm i -g @liara/cli',
    failed:
      'دستور Liara CLI با خطا تمام شد.',
    timeout:
      'دستور Liara CLI در زمان مقرر تمام نشد.',
    badJson:
      'خروجی Liara CLI قابل خواندن (JSON) نبود.',
  },
  db: {
    needsHuman: (name: string) =>
      `اطلاعات اتصال را از پنل لیارا ← دیتابیس ← ${name} کپی کنید.`,
  },
  approval: {
    denied: (title: string) =>
      `اقدام «${title}» تأیید نشد و اجرا نشد.`,
    headlessDenied:
      'در حالت بدون تعامل، اقدامات تغییردهنده بدون تأیید اجرا نمی‌شوند.',
    yesOnlyR1:
      'گزینهٔ --yes فقط اقدامات کم‌خطر (R1) را تأیید می‌کند؛ این اقدام تأیید صریح لازم دارد.',
    tokenInvalid:
      'توکن تأیید نامعتبر، منقضی یا قبلاً استفاده‌شده است، یا پارامترها تغییر کرده‌اند.',
    costCap: (cost: string, cap: string) =>
      `هزینهٔ ماهانهٔ این اقدام (${cost}) از سقف تعیین‌شده در policy (${cap}) بیشتر است؛ بدون پرسیدن رد شد.`,
    headlessNotAllowed: (risk: string) =>
      `در حالت بدون تعامل، policy فقط اجرای خودکار سطح‌های مجاز را می‌دهد؛ این اقدام (${risk}) رد شد.`,
    invalidPolicy: 'فایل policy (siavash.policy.yaml) نامعتبر است.',
    nonInteractive:
      'ورودی تعاملی در دسترس نیست؛ این اقدام بدون تأیید صریح اجرا نمی‌شود.',
    card: {
      title: 'تأیید اقدام',
      what: 'چه:',
      why: 'چرا:',
      target: 'منبع:',
      cost: 'هزینه:',
      costNone: 'بدون هزینهٔ مستقیم',
      perMonth: 'در ماه',
      oneTime: 'یک‌باره',
      risk: 'ریسک:',
      impact: 'اثر:',
      rollback: 'راه برگشت:',
      command: 'دستور دقیق:',
      escalated: 'ریسک به‌خاطر این قواعد بالا رفت:',
      riskNames: ['فقط خواندنی', 'کم‌خطر و برگشت‌پذیر', 'پرهزینه یا اثرگذار', 'مخرب یا برگشت‌ناپذیر'],
    },
    choice: {
      question: 'انجام شود؟',
      run: 'انجام بده',
      no: 'نه',
      session: 'بله و برای این جلسه نپرس',
      edit: 'ویرایش پارامترها',
    },
    editParams: 'پارامترها را به صورت JSON ویرایش کنید:',
    invalidJson: 'JSON نامعتبر است؛ یک شیء JSON وارد کنید.',
    typeName: (name: string) =>
      `این اقدام مخرب یا برگشت‌ناپذیر است. برای تأیید، نام «${name}» را دقیقاً تایپ کنید:`,
    nameMismatch: 'نام واردشده مطابقت ندارد؛ اقدام لغو شد.',
  },
  analyzer: {
    portHardcoded: (port: number) =>
      `پورت ${port} در کد ثابت نوشته شده و متغیر PORT خوانده نمی‌شود.`,
    portHardcodedFix:
      'پورت را از متغیر محیطی بخوانید، مثلاً: const port = process.env.PORT || 3000',
    bindLocalhost: (host: string) =>
      `برنامه روی ${host} گوش می‌دهد؛ داخل کانتینر از بیرون قابل دسترس نیست.`,
    bindLocalhostFix:
      'برنامه را روی 0.0.0.0 اجرا کنید (مثلاً app.listen(port, "0.0.0.0") یا host="0.0.0.0").',
    portDefaultAssumed: (port: number) =>
      `پورت در کد پیدا نشد؛ پورت پیش‌فرض ${port} فرض شد.`,
    portDefaultAssumedFix:
      'اگر برنامه روی پورت دیگری اجرا می‌شود، آن را مشخص کنید.',
    noStartScript:
      'اسکریپت start در package.json وجود ندارد؛ لیارا نمی‌داند برنامه را چطور اجرا کند.',
    noStartScriptFix:
      'یک اسکریپت start اضافه کنید، مثلاً "start": "node index.js".',
    nodemonStart:
      'اسکریپت start از nodemon استفاده می‌کند که مخصوص توسعه است.',
    nodemonStartFix:
      'برای production از node استفاده کنید: "start": "node index.js" و nodemon را در "dev" بگذارید.',
    runtimeInDevDeps: (pkg: string) =>
      `بستهٔ «${pkg}» برای اجرای برنامه لازم است اما در devDependencies قرار دارد.`,
    runtimeInDevDepsFix: (pkg: string) =>
      `«${pkg}» را به dependencies منتقل کنید (npm i ${pkg}).`,
    noBuildScript:
      'این پروژه build لازم دارد اما اسکریپت build ندارد.',
    noBuildScriptFix:
      'یک اسکریپت build به package.json اضافه کنید.',
    pythonNoServer:
      'سرور production (مثل gunicorn یا uvicorn) در وابستگی‌های پایتون پیدا نشد.',
    pythonNoServerFix:
      'gunicorn (برای django/flask) یا uvicorn (برای fastapi) را به requirements.txt اضافه کنید.',
  },
  preflight: {
    title: 'بررسی‌های اولیه',
    tokenOk: (n: number | undefined) =>
      n === undefined ? 'توکن لیارا معتبر است.' : `توکن لیارا معتبر است (${n} اپ قابل مشاهده).`,
    tokenMissing: 'توکن API لیارا تنظیم نشده است.',
    tokenInvalid: 'توکن API لیارا نامعتبر است یا منقضی شده.',
    tokenFix:
      'از console.liara.ir بخش API یک توکن بسازید و در فایل .env مقدار LIARA_API_TOKEN را تنظیم کنید.',
    tokenError: (msg: string) =>
      `اتصال به لیارا برای بررسی توکن ناموفق بود: ${msg}`,
    tokenErrorFix: 'اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.',
    teamSet: (id: string) =>
      `عملیات روی تیم «${id}» انجام می‌شود.`,
    teamPersonal:
      'عملیات روی حساب شخصی انجام می‌شود (LIARA_TEAM_ID تنظیم نشده).',
    teamFix:
      'اگر می‌خواهید روی تیم کار کنید، LIARA_TEAM_ID را در .env تنظیم کنید.',
    cliOk: (version: string | undefined) =>
      `Liara CLI آماده است${version ? ` (نسخهٔ ${version})` : ''}.`,
    cliMissing: 'Liara CLI پیدا نشد؛ برای deploy و فهرست پلن‌ها لازم است.',
    projectMissing: (path: string) =>
      `پوشهٔ پروژه پیدا نشد: ${path}`,
    projectFix: 'مسیر پروژه را بررسی کنید یا دستور را داخل پوشهٔ پروژه اجرا کنید.',
    projectOk: 'پوشهٔ پروژه پیدا شد.',
    gitDirty: (n: number) =>
      `${n} فایل تغییر commit‌نشده دارد؛ همین نسخهٔ فعلی پوشه deploy می‌شود.`,
    gitDirtyFix:
      'اگر می‌خواهید نسخهٔ مشخصی deploy شود، اول تغییرات را commit کنید.',
    gitClean: 'مخزن git تمیز است.',
    gitNone: 'پروژه مخزن git ندارد؛ تاریخچهٔ نسخه‌ها فقط در لیارا نگه داشته می‌شود.',
    liaraignoreMissing:
      'فایل .liaraignore وجود ندارد؛ ممکن است فایل‌های اضافه (مثل node_modules یا .env) آپلود شوند.',
    liaraignoreFix:
      'یک فایل .liaraignore بسازید و node_modules، .env و .git را در آن بنویسید.',
    liaraignoreOk: 'فایل .liaraignore وجود دارد.',
    failed: (lines: string) =>
      `بررسی‌های اولیه ناموفق بود:\n${lines}`,
    line: (what: string, fix: string | undefined) =>
      fix ? `• ${what}\n  چه کار کنید: ${fix}` : `• ${what}`,
  },
  analyzeStep: {
    title: 'تحلیل پروژه و سؤال‌ها',
    summaryTitle: 'نتیجهٔ تحلیل پروژه',
    summary: (r: { platform: string; port: number; start?: string; build?: string; dbs: string[]; diskFolders: string[]; files: number; mb: number; warnings: number; missingEnv: string[] }) =>
      [
        `نوع پروژه: ${r.platform}`,
        `پورت: ${r.port}`,
        r.build ? `build: ${r.build}` : undefined,
        r.start ? `اجرا: ${r.start}` : undefined,
        r.dbs.length > 0 ? `دیتابیس لازم: ${r.dbs.join('، ')}` : undefined,
        r.diskFolders.length > 0 ? `دیسک برای پوشه‌های: ${r.diskFolders.join('، ')}` : undefined,
        r.missingEnv.length > 0 ? `متغیرهای محیطی لازم: ${r.missingEnv.join('، ')}` : undefined,
        `حجم: ${r.files} فایل، ${r.mb}MB`,
        r.warnings > 0 ? `${r.warnings} هشدار (جزئیات پایین‌تر)` : undefined,
      ]
        .filter(Boolean)
        .join('\n'),
    warningsTitle: 'هشدارها',
    warningLine: (msg: string, fix: string) =>
      `• ${msg}\n  راه‌حل: ${fix}`,
    blockersTitle: 'مشکلات جدی',
    blockerChoice: 'این مشکلات ممکن است deploy را خراب کنند. چه کنیم؟',
    blockerContinue: 'بی‌خیال، deploy کن',
    blockerCancel: 'لغو',
    cancelled: 'عملیات لغو شد.',
    redeployQuestion: (app: string) =>
      `این پروژه قبلاً روی اپ «${app}» deploy شده. چه کنیم؟`,
    redeploySame: (app: string) =>
      `redeploy روی همان اپ «${app}»`,
    redeployNew: 'ساخت اپ جدید',
    appNameQuestion: 'نام اپ در لیارا:',
    appNameInvalid:
      'نام اپ فقط می‌تواند حروف کوچک انگلیسی، عدد و خط تیره داشته باشد، با حرف شروع شود و ۳ تا ۳۲ کاراکتر باشد.',
    appNameTaken: (name: string, alt: string) =>
      `اپی با نام «${name}» در حساب شما وجود دارد. پیشنهاد: «${alt}»`,
    goalQuestion: 'هدف این deploy چیست؟',
    goalTest: 'تست یا دمو (ارزان‌تر)',
    goalProduction: 'production (کاربران واقعی)',
  },
  planBilling: {
    title: 'انتخاب پلن و بررسی موجودی',
    chooseQuestion: 'کدام پلن را انتخاب می‌کنید؟',
    tier: { economy: 'اقتصادی', recommended: 'پیشنهادی', performance: 'قدرتمند' } as Record<string, string>,
    option: (tier: string, plan: string, ramMb: number, cpu: number, price: string) =>
      `${tier}: ${plan} (حافظه ${ramMb}MB، CPU ${cpu}) — ${price} در ماه`,
    lowBalanceTitle: 'موجودی کافی نیست',
    lowBalance: (balance: string, need: string) =>
      `موجودی شما ${balance} است؛ برای این پلن حداقل ${need} لازم است. شارژ حساب از طریق API ممکن نیست؛ لطفاً از https://console.liara.ir شارژ کنید.`,
    topUpQuestion: 'بعد از شارژ حساب، ادامه دهیم؟',
    toppedUp: 'شارژ کردم',
    cancelTopUp: 'لغو (بعداً با --resume ادامه می‌دهیم)',
    stillLow: (balance: string) =>
      `موجودی هنوز ${balance} است.`,
    waitingTopUp: (need: string) =>
      `منتظر شارژ حساب هستیم (حداقل ${need}). بعد از شارژ، با --resume ادامه دهید.`,
    balanceOk: (balance: string) =>
      `موجودی کافی است (${balance}).`,
    approveTitle: (app: string) =>
      `ساخت و deploy اپ «${app}» روی لیارا`,
    approveReason: 'برنامهٔ کامل deploy: اپ و منابع جانبی',
    impactApp: (plan: string, price: string) =>
      `اپ با پلن ${plan} — ${price} در ماه`,
    impactDb: (type: string) =>
      `دیتابیس ${type} (قیمت از لیارا در دسترس نیست)`,
    impactDisk: (folders: string) =>
      `دیسک برای ${folders} (قیمت از لیارا در دسترس نیست)`,
    impactTotal: (total: string, complete: boolean) =>
      complete ? `جمع: ${total} در ماه` : `جمع: حداقل ${total} در ماه (بدون موارد نامعلوم)`,
    rollback:
      'تا این مرحله هیچ منبعی ساخته نشده است. منابع ساخته‌شده را بعداً می‌توانید با دستور حذف پاک کنید.',
  },
  provision: {
    title: 'ساخت اپ و منابع',
    notApproved:
      'برنامهٔ deploy هنوز تأیید نشده است؛ هیچ منبعی ساخته نمی‌شود.',
    createAppTitle: (app: string, plan: string) =>
      `ساخت اپ «${app}» با پلن ${plan}`,
    createAppImpact: 'یک اپ جدید در لیارا ساخته می‌شود و هزینهٔ ماهانهٔ پلن از موجودی کم می‌شود.',
    createAppRollback: (app: string) =>
      `با «siavash delete ${app}» قابل حذف است.`,
    createDbTitle: (name: string, type: string) =>
      `ساخت دیتابیس ${type} با نام «${name}»`,
    createDbReason: 'پروژه به دیتابیس نیاز دارد.',
    createDbImpact: 'یک دیتابیس جدید ساخته می‌شود و هزینهٔ ماهانهٔ جداگانه دارد.',
    createDbRollback: (name: string) =>
      `دیتابیس را می‌توانید با «liara db remove -n ${name}» حذف کنید (همهٔ داده‌ها پاک می‌شود).`,
    dbPlanQuestion:
      'شناسهٔ پلن دیتابیس را وارد کنید (از بخش دیتابیس‌های console.liara.ir):',
    dbPlanNeeded:
      'شناسهٔ پلن دیتابیس مشخص نیست و در حالت --yes نمی‌توان آن را حدس زد.',
    dbPlanNeededFix:
      'یک بار بدون --yes اجرا کنید یا پلن دیتابیس را مشخص کنید.',
    dbUnsupported: (type: string) =>
      `ساخت خودکار دیتابیس ${type} پشتیبانی نمی‌شود؛ آن را دستی بسازید و آدرسش را در مرحلهٔ تنظیم env وارد کنید.`,
    dbManualTitle: 'اطلاعات اتصال دیتابیس',
    dbHost: 'آدرس (host) دیتابیس:',
    dbPort: 'پورت دیتابیس:',
    dbUser: 'نام کاربری دیتابیس:',
    dbPassword: 'رمز دیتابیس (نمایش داده نمی‌شود):',
    dbName: 'نام دیتابیس (اختیاری):',
    dbPortInvalid: 'پورت باید عدد بین ۱ تا ۶۵۵۳۵ باشد.',
    noHiddenInput:
      'این رابط کاربری امکان ورود پنهان رمز را ندارد؛ رمز دیتابیس را در مرحلهٔ تنظیم env وارد کنید.',
    dbFailed: (msg: string) =>
      `ساخت دیتابیس ناموفق بود: ${msg}. اپ ساخته‌شده حذف نشد.`,
    cleanupQuestion: (app: string) =>
      `اپ «${app}» ساخته شده ولی دیتابیس ساخته نشد. با اپ چه کنیم؟`,
    cleanupKeep: 'نگه دار (بعداً دوباره تلاش می‌کنم)',
    cleanupDelete: 'حذف اپ (غیرقابل بازگشت)',
    cleanupReason: 'پاک‌سازی بعد از شکست در ساخت دیتابیس',
  },
  configure: {
    title: 'تنظیم env و فایل‌های پروژه',
    envIntro: (n: number) =>
      `${n} متغیر محیطی برای این پروژه پیدا شد. مقادیر محرمانه نمایش داده نمی‌شوند.`,
    envTitle: 'متغیرهای محیطی',
    askValue: (key: string, required: boolean) =>
      required ? `مقدار ${key}:` : `مقدار ${key} (اختیاری؛ خالی = رد کردن):`,
    askSecret: (key: string, required: boolean) =>
      required ? `مقدار ${key} (محرمانه؛ نمایش داده نمی‌شود):` : `مقدار ${key} (محرمانه، اختیاری؛ خالی = رد کردن):`,
    requiredEmpty: 'این متغیر لازم است؛ مقداری وارد کنید.',
    fromDatabase: (key: string) =>
      `${key} از دیتابیس ساخته‌شده پر شد.`,
    noHiddenInput: (key: string) =>
      `این رابط امکان ورود پنهان ندارد؛ ${key} را بعداً با «siavash env set» تنظیم کنید.`,
    envSkipped: (keys: string) =>
      `این متغیرها تنظیم نشدند: ${keys}`,
    liaraJsonTitle: 'تغییرات liara.json',
    liaraJsonQuestion: 'این تغییرات در liara.json نوشته شود؟',
    write: 'بنویس',
    skip: 'ننویس',
    liaraJsonInvalid:
      'فایل liara.json فعلی JSON معتبر نیست؛ تغییری در آن داده نشد. آن را اصلاح کنید.',
    diskMountPending: (folders: string) =>
      `مسیر اتصال دیسک برای ${folders} هنوز مشخص نیست؛ در مرحلهٔ deploy با دستور شما تنظیم می‌شود.`,
    liaraignoreCreated: 'فایل .liaraignore ساخته شد (node_modules، .env و .git آپلود نمی‌شوند).',
    zeroDowntimeReason: 'برای production، deploy بدون قطعی توصیه می‌شود.',
  },
  deployStep: {
    title: 'deploy',
    stage: {
      upload: 'آپلود کد',
      build: 'ساخت (build)',
      push: 'ارسال image',
      release: 'انتشار نسخهٔ جدید',
      done: 'تمام شد',
      failed: 'شکست خورد',
    } as Record<string, string>,
    archiving: 'فشرده‌سازی کد پروژه…',
    uploadPercent: (p: number) =>
      `آپلود: ${p}٪`,
    waitingRelease: 'منتظر آماده شدن نسخهٔ جدید…',
    approveTitle: (app: string) =>
      `deploy نسخهٔ جدید روی «${app}»`,
    approveReason: 'انتشار کد فعلی پروژه',
    approveImpact: (mode: string) =>
      `کد فعلی پوشهٔ پروژه با روش ${mode} آپلود و منتشر می‌شود؛ ممکن است اپ چند ثانیه ری‌استارت شود.`,
    approveRollback: 'با «siavash rollback» به نسخهٔ سالم قبلی برمی‌گردید.',
    succeeded: (version: string | undefined) =>
      version ? `deploy موفق بود (نسخهٔ ${version}).` : 'deploy موفق بود.',
    failed: 'deploy شکست خورد.',
    timeout:
      'نتیجهٔ deploy در زمان مقرر مشخص نشد؛ وضعیت اپ را بررسی کنید.',
    tailTitle: 'آخرین خطوط لاگ',
    noPlatform:
      'شناسهٔ پلتفرم لیارا برای این پروژه تأیید نشده؛ deploy از راه API ممکن نیست. از حالت CLI یا Dockerfile استفاده کنید.',
  },
  verify: {
    title: 'بررسی سلامت بعد از deploy',
    waitingRunning: 'منتظر بالا آمدن اپ…',
    probing: 'بررسی پاسخ‌گویی اپ…',
    observing: 'بررسی لاگ‌ها و رویدادهای دقیقهٔ اول…',
    notRunning: 'اپ در زمان مقرر بالا نیامد.',
    unavailable: (url: string) =>
      `اپ به هیچ درخواستی روی ${url} پاسخ سالم نداد.`,
    partial: (pct: number) =>
      `فقط ${pct}٪ درخواست‌ها پاسخ سالم گرفتند.`,
    crashEvents: (n: number) =>
      `${n} رویداد crash یا کمبود حافظه بعد از deploy ثبت شد.`,
    errorLogs: (n: number) =>
      `${n} خطای متفاوت در لاگ‌های بعد از deploy دیده شد.`,
    known: (title: string) =>
      `الگوی شناخته‌شده: ${title}`,
    healthy: (url: string) =>
      `اپ سالم است و روی ${url} پاسخ می‌دهد.`,
    handoff:
      'deploy انجام شد ولی برنامه درست بالا نیامد؛ دارم بررسی می‌کنم…',
    resultTitle: 'نتیجهٔ بررسی سلامت',
  },
  summary: {
    title: 'خلاصه',
    cardTitle: (app: string) =>
      `اپ «${app}» روی لیارا`,
    url: (url: string) =>
      `آدرس: ${url}`,
    plan: (plan: string, cost: string) =>
      `پلن: ${plan} — ${cost} در ماه`,
    resources: (list: string) =>
      `منابع ساخته‌شده: ${list}`,
    resApp: (name: string) => `اپ ${name}`,
    resDb: (name: string, type: string) => `دیتابیس ${type} (${name})`,
    resDisk: (name: string, gb: number) => `دیسک ${name} (${gb}GB)`,
    envs: (list: string) =>
      `متغیرهای محیطی: ${list}`,
    noEnvs: 'متغیرهای محیطی: —',
    listSep: '، ',
    health: (verdict: string, score: number) =>
      `سلامت: ${verdict} (امتیاز ${score} از ۱۰۰)`,
    verdict: { healthy: 'سالم', degraded: 'ناقص', failed: 'ناسالم' } as Record<string, string>,
    next: (app: string) =>
      [
        'دستورهای بعدی:',
        `  siavash status ${app}    وضعیت و سلامت`,
        `  siavash logs ${app}      لاگ‌ها`,
        `  siavash redeploy ${app}  deploy دوباره از کد فعلی`,
        `  siavash rollback ${app}  برگشت به نسخهٔ سالم قبلی`,
      ].join('\n'),
  },
  redeploy: {
    loadTitle: 'بارگذاری اطلاعات پروژه',
    noApp:
      'این پروژه هنوز به هیچ اپی deploy نشده است؛ اول «siavash deploy» را اجرا کنید.',
  },
  deployTools: {
    deployProject: 'deploy کامل پروژه روی لیارا (تحلیل، انتخاب پلن، ساخت منابع، تنظیم، deploy و بررسی سلامت)',
    redeployApp: 'deploy دوبارهٔ کد فعلی روی اپ موجود (بررسی اولیه، deploy، بررسی سلامت)',
    startTitle: (path: string) =>
      `شروع deploy پروژهٔ «${path}»`,
    startImpact:
      'مراحل deploy شروع می‌شود. هزینه و ساخت هر منبع جداگانه از شما تأیید گرفته می‌شود.',
    startRollback: 'تا قبل از تأیید برنامهٔ deploy چیزی ساخته نمی‌شود.',
  },
  resize: {
    title: (app: string, from: string, to: string) =>
      `تغییر پلن «${app}» از ${from} به ${to}`,
    impact: (from: string, to: string, diff: string) =>
      `پلن از ${from} به ${to} تغییر می‌کند؛ اختلاف هزینه: ${diff} در ماه. اپ هنگام تغییر پلن ری‌استارت می‌شود.`,
    rollback: (from: string) =>
      `با تغییر دوباره به پلن ${from} برمی‌گردد.`,
    defaultReason: 'به درخواست شما',
    same: (plan: string) =>
      `اپ همین حالا روی پلن ${plan} است؛ تغییری لازم نیست.`,
    toolDescription: 'تغییر پلن اپ (ارتقا یا کاهش منابع) با بررسی موجودی و تأیید تغییر',
  },
  power: {
    restartTitle: (app: string) => `ری‌استارت «${app}»`,
    startTitle: (app: string) => `روشن کردن «${app}»`,
    stopTitle: (app: string) => `خاموش کردن «${app}»`,
    defaultReason: 'به درخواست شما',
    restartImpact: 'برنامه دوباره اجرا می‌شود.',
    startImpact: 'برنامه با scale=1 روشن می‌شود و هزینهٔ پلن ادامه دارد.',
    stopImpact: 'برنامه خاموش می‌شود و تا روشن کردن دوباره در دسترس نیست.',
    downtime: (sec: number) =>
      `zero-downtime خاموش است؛ سایت حدود ${sec} ثانیه در دسترس نخواهد بود.`,
    downtimeUnknown:
      'اگر zero-downtime خاموش باشد، سایت چند ثانیه در دسترس نخواهد بود.',
    restartRollback: 'برگشت لازم نیست؛ فقط اجرای فعلی برنامه از نو شروع می‌شود.',
    startRollback: 'با «stop» دوباره خاموش می‌شود.',
    stopRollback: 'با «start» دوباره روشن می‌شود.',
    done: (action: string, sec: number) =>
      `${action} انجام و تأیید شد (${sec} ثانیه).`,
    restartTool: 'ری‌استارت اپ و تأیید بالا آمدن آن',
    startTool: 'روشن کردن اپ (scale=1) و تأیید بالا آمدن آن',
    stopTool: 'خاموش کردن اپ (scale=0) و تأیید خاموش شدن',
  },
  detectors: {
    'app-down': 'اپ از دسترس خارج است',
    'crash-loop': 'برنامه پشت سر هم crash و دوباره اجرا می‌شود',
    oom: 'برنامه به سقف حافظه رسیده (OOM)',
    'memory-leak-trend': 'مصرف حافظه به‌طور پیوسته بالا می‌رود (احتمال نشت حافظه)',
    'cpu-saturation': 'CPU نزدیک سقف پلن است',
    'http-5xx-rate': 'نرخ بالای خطای 5xx',
    'slow-response': 'پاسخ‌گویی کند',
    'missing-env': 'یک متغیر محیطی لازم تنظیم نشده',
    'port-mismatch': 'برنامه روی پورت یا آدرس اشتباه گوش می‌دهد',
    'db-connection': 'اتصال به دیتابیس برقرار نمی‌شود',
    'module-not-found': 'یک ماژول یا فایل پیدا نمی‌شود',
    'unhandled-exception': 'خطای مدیریت‌نشده در کد پروژه',
    'disk-full': 'دیسک پر است یا نزدیک پر شدن است',
    'release-regression': 'خطاها بعد از آخرین deploy شروع شده‌اند',
    'tls-issue': 'مشکل گواهی SSL/TLS',
    'read-only-fs': 'برنامه روی فایل‌سیستم فقط‌خواندنی می‌نویسد',
  } as Record<string, string>,
  rca: {
    regressionTitle: 'نسخهٔ جدید خراب است',
    regressionExplain:
      'خطاها درست بعد از آخرین deploy شروع شده‌اند و برنامه با نسخهٔ جدید بالا نمی‌آید؛ نسخهٔ قبلی سالم بوده است.',
    symptomTitle: 'برنامه بالا نمی‌آید و علت دقیق هنوز مشخص نیست',
    symptomExplain:
      'برنامه پاسخ نمی‌دهد یا مدام ری‌استارت می‌شود، اما در داده‌ها علت مشخصی دیده نشد.',
    explain: {
      'missing-env': 'برنامه هنگام شروع به یک متغیر محیطی نیاز دارد که روی لیارا تنظیم نشده است.',
      'db-connection': 'برنامه به دیتابیس وصل نمی‌شود؛ معمولاً آدرس دیتابیس اشتباه است یا به localhost اشاره می‌کند.',
      oom: 'برنامه بیش از حافظهٔ پلن مصرف می‌کند و سیستم آن را متوقف می‌کند.',
      'port-mismatch': 'برنامه روی پورت یا آدرسی گوش می‌دهد که لیارا به آن درخواست نمی‌فرستد.',
      'disk-full': 'فضای دیسک تمام شده و برنامه نمی‌تواند فایل بنویسد.',
      'read-only-fs': 'برنامه روی فایل‌سیستم فقط‌خواندنی فایل می‌نویسد.',
      'module-not-found': 'یک فایل یا بسته که کد به آن نیاز دارد در نسخهٔ منتشرشده وجود ندارد.',
      'unhandled-exception': 'یک باگ در کد پروژه هنگام پاسخ به درخواست‌ها خطا می‌دهد.',
      'memory-leak-trend': 'مصرف حافظه مدام بالا می‌رود؛ احتمالاً کد حافظه را آزاد نمی‌کند.',
      'cpu-saturation': 'پردازنده نزدیک سقف پلن کار می‌کند و پاسخ‌ها کند می‌شوند.',
      'slow-response': 'پاسخ‌ها کند است؛ احتمالاً منابع پلن کافی نیست یا یک عملیات سنگین وجود دارد.',
      'tls-issue': 'گواهی SSL دامنه معتبر نیست یا هنوز صادر نشده است.',
    } as Record<string, string>,
    effect: {
      set_env: 'با تنظیم متغیر، برنامه بعد از ری‌استارت درست بالا می‌آید.',
      resize_app: 'با حافظه و CPU بیشتر، برنامه دیگر به سقف نمی‌رسد.',
      restart_app: 'اجرای برنامه از نو شروع می‌شود.',
      rollback_app: 'نسخهٔ سالم قبلی دوباره منتشر می‌شود.',
      redeploy_app: 'نسخهٔ جدیدی از کد فعلی ساخته و منتشر می‌شود.',
      code_patch: 'باگ در کد اصلاح و نسخهٔ جدید منتشر می‌شود.',
      config_file: 'فایل پیکربندی اصلاح می‌شود.',
      run_in_container: 'یک دستور از پیش‌تعریف‌شده داخل کانتینر اجرا می‌شود.',
      set_read_only: 'تنظیم فقط‌خواندنی بودن فایل‌سیستم تغییر می‌کند.',
      create_disk: 'یک دیسک پایدار برای ذخیرهٔ فایل‌ها اضافه می‌شود.',
      manual: 'این کار باید دستی انجام شود.',
    } as Record<string, string>,
    verify: {
      set_env: 'بعد از ری‌استارت، لاگ‌ها نباید خطای قبلی را نشان دهند و health check سالم باشد.',
      resize_app: 'مصرف حافظه زیر ۸۰٪ بماند و رویداد OOM تکرار نشود.',
      restart_app: 'اپ بالا بیاید و تا چند دقیقه دوباره crash نکند.',
      rollback_app: 'بعد از برگشت، health check سالم باشد و خطاها متوقف شوند.',
      redeploy_app: 'deploy موفق شود و health check سالم باشد.',
      code_patch: 'مسیری که خطا می‌داد پاسخ ۲۰۰ بدهد و خطا در لاگ تکرار نشود.',
      default: 'health check را دوباره اجرا کنید و لاگ‌ها را بررسی کنید.',
    } as Record<string, string>,
    llmUnavailable:
      'تحلیل هوشمند در دسترس نبود؛ فرضیه‌ها فقط از قواعد قطعی و پایگاه دانش ساخته شدند.',
  },
  buildDoctor: {
    title: 'تحلیل شکست build',
    cause: {
      'missing-build-script': 'اسکریپت build در package.json تعریف نشده است.',
      'node-version': 'نسخهٔ Node مناسب این پروژه نیست.',
      'typescript-error': 'کد TypeScript خطای کامپایل دارد.',
      'peer-deps': 'وابستگی‌های npm با هم سازگار نیستند (peer dependency).',
      lockfile: 'package-lock.json با package.json هماهنگ نیست.',
      dockerfile: 'Dockerfile خطا دارد.',
      'build-oom': 'حافظه هنگام build تمام شد.',
      unknown: 'علت شکست build به‌طور قطعی مشخص نشد.',
    } as Record<string, string>,
    explain: {
      'missing-build-script': (start: string) => `اسکریپت start فایل‌های ساخته‌شده را اجرا می‌کند (${start}) ولی هیچ اسکریپت build‌ای آن‌ها را نمی‌سازد.`,
    },
    fix: {
      addScript: (name: string, cmd: string) => `افزودن اسکریپت "${name}": "${cmd}" به package.json`,
      engines: (v: string) => `تنظیم engines.node روی "${v}" در package.json`,
      npmrc: 'افزودن legacy-peer-deps=true به فایل .npmrc',
      codePatch: 'اصلاح خطای کامپایل در کد (مسیر اصلاح کد)',
      lockfile: 'npm install را محلی اجرا کنید و package-lock.json جدید را commit کنید.',
      dockerfile: 'Dockerfile را طبق خطای نمایش‌داده‌شده اصلاح کنید.',
      buildOom: 'متغیر NODE_OPTIONS را روی --max-old-space-size=… تنظیم کنید یا build را سبک‌تر کنید.',
      manual: 'لاگ build را بررسی کنید و خطای اول را برطرف کنید.',
    },
    findingsTitle: 'علت شکست build',
    applyQuestion: 'این اصلاح روی پروژه اعمال و دوباره deploy شود؟',
    apply: 'اعمال و deploy دوباره',
    skip: 'فعلاً نه',
    diffTitle: 'تغییر پیشنهادی',
    applied: 'اصلاح اعمال شد.',
  },
  chat: {
    welcome: 'سلام! من سیاوش هستم؛ کمکتان می‌کنم اپ‌هایتان را روی لیارا بالا بیاورید و سالم نگه دارید.',
    suggestionsTitle: 'مثلاً بگویید:',
    suggestions: ['پروژه‌مو دیپلوی کن', 'وضعیت سایتم چطوره؟', 'سایتم کند شده'],
    hint: 'دستورها: /help ، /app <نام> ، /dry-run on|off ، /history ، /exit — Ctrl+C کار جاری را لغو می‌کند.',
    prompt: 'شما',
    help: [
      '/help — همین راهنما',
      '/app <نام> — انتخاب اپ پیش‌فرض گفتگو',
      '/dry-run on|off — حالت آزمایشی (هیچ تغییری اعمال نمی‌شود)',
      '/history — پیام‌های اخیر شما',
      '/exit — خروج',
    ],
    appSet: (app: string) => `اپ پیش‌فرض: ${app}`,
    noAppYet: 'اپ پیش‌فرض انتخاب نشده؛ با /app <نام> انتخاب کنید.',
    dryRun: (on: boolean) => (on ? 'حالت آزمایشی روشن شد: هیچ تغییری اعمال نمی‌شود.' : 'حالت آزمایشی خاموش شد.'),
    unknownCommand: (c: string) => `دستور ${c} را نمی‌شناسم؛ /help را ببینید.`,
    historyEmpty: 'هنوز پیامی نفرستاده‌اید.',
    bye: 'خدانگهدار!',
    cancelled: 'کار جاری لغو شد.',
    thinking: 'در حال فکر کردن…',
    needApp: 'برای عیب‌یابی نام اپ را بگویید (مثلاً /app shop).',
    tool: {
      list_apps: '📋 در حال خواندن فهرست اپ‌ها…',
      get_app: '🔎 در حال خواندن اطلاعات اپ…',
      app_overview: '🔎 در حال جمع کردن نمای کلی اپ…',
      get_logs: '🔎 در حال خواندن لاگ‌های اخیر…',
      get_events: '🔎 در حال خواندن رویدادهای اخیر…',
      get_metrics_summary: '📈 در حال خواندن مصرف منابع…',
      get_metrics_series: '📈 در حال خواندن روند مصرف منابع…',
      health_check: '🩺 در حال بررسی سلامت اپ…',
      diagnose_app: '🩺 در حال عیب‌یابی…',
      deploy_project: '🚀 در حال deploy پروژه…',
      redeploy_app: '🚀 در حال deploy دوباره…',
      restart_app: '🔄 در حال ری‌استارت اپ…',
      list_plans: '📋 در حال خواندن پلن‌ها…',
      get_billing: '💳 در حال خواندن موجودی حساب…',
    } as Record<string, string>,
    toolGeneric: (tool: string) => `⚙️ در حال اجرای ${tool}…`,
    toolFailed: (tool: string) => `⚠️ ${tool} انجام نشد.`,
    approvalNeeded: (title: string) => `✋ این کار تأیید شما را لازم دارد: ${title}`,
    humanStep: (text: string) => `👤 قدم شما: ${text}`,
  },
  intent: {
    // Persian keywords for the rule-based intent router (T3.7); matched after normalisation
    // (ي/ك → ی/ک, no ZWNJ, Persian digits → ASCII), so write them without half-spaces.
    keywords: {
      deploy: ['دیپلوی', 'دپلوی', 'بالا بیار', 'بالا بیاور', 'منتشر', 'انتشار', 'آپلود', 'راه بنداز', 'راه اندازی کن', 'مستقر', 'روی لیارا ببر', 'بفرست روی لیارا'],
      redeploy: ['دوباره دیپلوی', 'دوباره منتشر', 'مجدد دیپلوی', 'دیپلوی مجدد', 'دوباره بفرست', 'نسخه جدید رو بفرست', 'تغییرات رو بفرست'],
      diagnose: ['کند شده', 'کنده', 'کندی', 'خیلی کند', 'خطا', 'ارور', 'اررور', '500', '502', '503', 'نمیاد بالا', 'بالا نمیاد', 'بالا نمیآد', 'کرش', 'خراب', 'از کار افتاده', 'قطع', 'مشکل', 'باگ', 'پایین است', 'پایینه', 'جواب نمیده', 'لود نمیشه', 'باز نمیشه', 'عیب یابی', 'عیبیابی', 'چرا کار نمیکنه'],
      status: ['وضعیت', 'چطوره', 'حالش', 'سالمه', 'آنلاین', 'لاگ', 'مصرف', 'حافظه', 'سی پی یو', 'گزارش'],
      manage: ['ریاستارت', 'ری استارت', 'ریستارت', 'خاموش', 'روشن کن', 'متغیر', 'پلن', 'ارتقا', 'ارتقاء', 'کوچک کن', 'بزرگ کن', 'برگردون', 'برگردان', 'نسخه قبل', 'بکاپ', 'پشتیبان', 'دیسک', 'حذف کن', 'پاک کن', 'تنظیمات'],
      domain: ['دامنه', 'دومین', 'گواهی', 'اس اس ال', 'رکورد'],
      question: ['چیه', 'چیست', 'چطور', 'چگونه', 'چرا', 'آیا', 'میشه', 'میتونی', 'قیمت', 'هزینه', 'تفاوت', 'فرق'],
    } as Record<string, string[]>,
  },
  cards: {
    hypothesis: (n: number) => `فرضیهٔ ${n}`,
    confidence: 'اطمینان:',
    plain: 'به زبان ساده:',
    evidence: 'شواهد:',
    fixes: 'راهکارها:',
    quick: 'سریع',
    root: 'ریشه‌ای',
    needs: (what: string) => `(لازم: ${what})`,
    more: (n: number) => `… و ${n} مورد دیگر (با --verbose کامل ببینید)`,
    otherHypotheses: 'فرضیه‌های دیگر:',
    problem: 'مشکل:',
    overviewTitle: (app: string) => `اپ «${app}»`,
    status: (status: string, scale: number) => `وضعیت: ${status} — مقیاس ${scale}`,
    plan: (id: string, ram: string, cpu: string) => `پلن: ${id} — حافظه ${ram}، پردازنده ${cpu} هسته`,
    lastDeploy: (when: string, result: string, version: string) => `آخرین deploy: ${when} — ${result}${version ? ` (${version})` : ''}`,
    noDeploy: 'آخرین deploy: ثبت نشده',
    envCount: (n: number) => `متغیرهای محیطی: ${n}`,
    domains: 'دامنه‌ها:',
    domainLine: (name: string, ssl: string) => `${name} — SSL: ${ssl}`,
    disks: 'دیسک‌ها:',
    cpu: 'پردازنده',
    memory: 'حافظه',
    resources: 'مصرف منابع:',
    rawValue: (v: string) => `${v} (واحد نامشخص)`,
    events: 'رویدادهای اخیر:',
    probe: (availability: string, p95: string) => `پاسخ‌گویی: ${availability} — p95: ${p95}`,
    ms: (n: string) => `${n} میلی‌ثانیه`,
    failed: (parts: string) => `این بخش‌ها دریافت نشدند: ${parts}`,
    health: 'سلامت:',
    compareTitle: 'قبل و بعد از اصلاح',
    compareHead: ['شاخص', 'قبل', 'بعد', ''] as const,
    better: 'بهتر',
    worse: 'بدتر',
    same: '—',
    limitTitle: 'محدودیت',
    limitWhat: 'چه چیزی ممکن نیست:',
    limitWhy: 'چرا:',
    limitAlt: 'راه جایگزین:',
    limitsTitle: 'کارهایی که سیاوش خودش انجام نمی‌دهد',
    humanOnly: 'فقط با دست شما:',
    agentLimits: 'محدودیت‌های عامل:',
    // the same items as KNOWN_LIMITS (03-TASKS T10.4 (a) and (f)); the full catalog comes with T10.4
    knownHumanOnly: ['شارژ حساب لیارا', 'خرید دامنه', 'تغییر رکوردهای DNS در سایت ثبت‌کنندهٔ دامنه'],
    knownAgent: ['پایش شبانه‌روزی ندارد: بررسی‌ها فقط به درخواست شما یا برای مدت کوتاه انجام می‌شوند', 'تشخیص‌ها احتمالی‌اند و با شاهد ارائه می‌شوند، نه با قطعیت'],
    knownNote: 'سؤال‌های باز دربارهٔ API در docs/OPEN_QUESTIONS.md ثبت شده‌اند؛ رفتارهای نامعلوم محتاطانه انجام می‌شوند.',
  },
  steps: {
    waitingYou: 'منتظر شما',
    waitingApproval: 'منتظر تأیید شما',
    seconds: (s: string) => `${s} ثانیه`,
    status: {
      pending: 'در صف',
      running: 'در حال انجام',
      done: 'انجام شد',
      failed: 'شکست خورد',
      skipped: 'رد شد',
      'waiting-human': 'منتظر شما',
      'waiting-approval': 'منتظر تأیید',
    } as Record<string, string>,
    pipelineDone: 'همهٔ مراحل انجام شد.',
    pipelineFailed: (step: string) => `در مرحلهٔ «${step}» متوقف شد.`,
    pipelineWaiting: 'کار متوقف است تا شما قدم بعدی را انجام دهید.',
    pipelineCancelled: 'لغو شد.',
  },
  cmd: {
    program: 'سیاوش — دستیار deploy و نگهداری اپ‌ها روی لیارا (بدون آرگومان: گفتگو)',
    help: {
      usage: 'استفاده:',
      args: 'آرگومان‌ها:',
      options: 'گزینه‌ها:',
      commands: 'دستورها:',
      global: 'گزینه‌های عمومی:',
      option: 'نمایش راهنمای این دستور',
      command: 'نمایش راهنمای یک دستور',
      version: 'نمایش نسخه',
      examples: 'مثال:',
    },
    opt: {
      app: 'نام اپ روی لیارا (پیش‌فرض: از .siavash/project.json)',
      dryRun: 'فقط نشان بده چه می‌شود؛ هیچ تغییری نده',
      verbose: 'جزئیات بیشتر (خروجی خام و جزئیات فنی خطا)',
      json: 'خروجی JSON (برای اسکریپت)',
      yes: 'تأیید خودکار فقط برای اقدامات کم‌خطر (R1)؛ R2 و R3 همیشه سؤال می‌شوند',
      resume: 'ادامه از مرحله‌ای که قبلاً متوقف شد',
      mode: 'روش deploy: cli یا api',
      follow: 'لاگ‌های جدید را دنبال کن (Ctrl+C برای خروج)',
      since: 'بازهٔ زمانی، مثل 15m، 2h یا 1d',
      describe: 'شرح مشکل به زبان خودتان',
      interval: 'فاصلهٔ بررسی (ثانیه)',
      duration: 'مدت پایش (دقیقه)',
      plan: 'شناسهٔ پلن جدید (از siavash limits یا list_plans)',
      to: 'شناسهٔ deployment مقصد (از siavash deployments)',
      size: 'اندازه به گیگابایت',
      name: 'نام',
      disk: 'نام دیسک',
      undo: 'برگرداندن آخرین اقدام',
    },
    login: 'ذخیرهٔ توکن لیارا در ~/.siavash/credentials و بررسی فوری آن',
    deploy: 'deploy کامل یک پروژه (تحلیل، پلن و هزینه، ساخت منابع، deploy، بررسی سلامت)',
    redeploy: 'deploy دوبارهٔ کد فعلی روی اپ موجود',
    status: 'نمای کلی اپ: وضعیت، پلن، آخرین deploy، منابع، رویدادها',
    logs: 'لاگ‌های اخیر اپ',
    events: 'رویدادهای اخیر اپ (deploy، ری‌استارت، crash…)',
    doctor: 'عیب‌یابی اپ: یافتن علت با شاهد و پیشنهاد راهکار',
    watch: 'پایش زندهٔ سلامت اپ',
    env: 'متغیرهای محیطی اپ',
    envList: 'فهرست متغیرها (مقدارها پوشیده)',
    envSet: 'افزودن یا تغییر متغیر (مقدار را بی‌صدا می‌پرسد اگر ندهید)',
    envUnset: 'حذف متغیر',
    restart: 'ری‌استارت اپ',
    start: 'روشن کردن اپ',
    stop: 'خاموش کردن اپ',
    resize: 'تغییر پلن اپ',
    rollback: 'برگشت به نسخهٔ سالم قبلی',
    settings: 'تنظیمات اپ: zero-downtime، subdomain، fixed-ip، read-only',
    domain: 'دامنه‌ها',
    domainList: 'فهرست دامنه‌ها و وضعیت SSL',
    disk: 'دیسک‌ها',
    diskList: 'فهرست دیسک‌ها و میزان پر بودن',
    diskCreate: 'ساخت دیسک',
    diskResize: 'تغییر اندازهٔ دیسک',
    backup: 'بکاپ دیسک',
    backupCreate: 'گرفتن بکاپ',
    backupList: 'فهرست بکاپ‌ها',
    backupDownload: 'لینک موقت دانلود بکاپ',
    db: 'دیتابیس‌ها',
    dbList: 'فهرست دیتابیس‌ها',
    dbCreate: 'ساخت دیتابیس',
    deployments: 'تاریخچهٔ deployها',
    runbook: 'runbookها (اقدامات آماده)',
    schedule: 'زمان‌بندی کارها',
    history: 'تاریخچهٔ اقدامات انجام‌شده',
    limits: 'کارهایی که سیاوش خودش نمی‌تواند انجام دهد',
    mcp: 'اجرای MCP Server روی stdio',
    notYet: (what: string) =>
      `این دستور هنوز آماده نیست (${what})؛ در نسخه‌های بعدی اضافه می‌شود.`,
    chatNotYet: 'حالت گفتگو هنوز آماده نیست؛ فعلاً از دستورها استفاده کنید (siavash --help).',
    dryRunTitle: 'اجرای آزمایشی (بدون تغییر)',
    failed: 'انجام نشد',
    pending: 'منتظر تأیید است.',
    pickApp: 'کدام اپ؟',
    noApp: 'نام اپ مشخص نیست؛ با --app بدهید یا پروژه را یک بار deploy کنید.',
    tokenPrompt: 'توکن API لیارا (از پنل لیارا ← کلید API):',
    teamPrompt: 'شناسهٔ تیم (اگر ندارید خالی بگذارید):',
    loginOk: (path: string) => `توکن بررسی شد و ذخیره شد: ${path}`,
    loginBad: 'توکن بررسی نشد (لیارا آن را نپذیرفت)؛ چیزی ذخیره نشد.',
    noHiddenInput: 'ورودی پنهان در دسترس نیست؛ مقدار را این‌جا وارد نمی‌کنم.',
    envValue: (key: string) => `مقدار ${key} (نمایش داده نمی‌شود):`,
    badEnvPair: (s: string) => `«${s}» به شکل KEY یا KEY=VALUE نیست.`,
    badOnOff: 'مقدار باید on یا off باشد.',
    badDuration: 'بازهٔ زمانی نامعتبر است (مثال: 15m، 2h، 1d).',
    badNumber: 'عدد نامعتبر است.',
    doctorChoose: 'کدام راهکار را اجرا کنم؟',
    doctorQuick: 'راهکار سریع',
    doctorRoot: 'راهکار ریشه‌ای',
    doctorSkip: 'فعلاً هیچ‌کدام',
    secretLinkWarn: 'این لینک محرمانه است؛ آن را جایی منتشر نکنید.',
  },
  manageTools: {
    rollback: 'برگرداندن اپ به آخرین نسخهٔ سالم یا نسخهٔ مشخص (R2)',
    setEnv: 'افزودن یا تغییر متغیرهای محیطی اپ (مقدارها نمایش داده نمی‌شوند)',
    unsetEnv: 'حذف متغیرهای محیطی اپ',
    setting: (name: string) =>
      `روشن یا خاموش کردن تنظیم ${name}`,
    createDisk: 'ساخت دیسک برای اپ (هزینه دارد)',
    resizeDisk: 'تغییر اندازهٔ دیسک اپ',
    createBackup: 'گرفتن بکاپ از دیسک اپ',
    backupLink: 'لینک موقت دانلود بکاپ (لینک محرمانه است)',
    deleteApp: 'حذف اپ همراه دیسک‌ها و دامنه‌ها (R3؛ باید نام اپ تایپ شود)',
  },
  fixBrief: {
    summary: (cause: string, location: string, pct: number) =>
      `خلاصه برای شما: علت محتمل «${cause}» (اطمینان ${pct}٪) در ${location}. این متن را به Agent برنامه‌نویسی خود (Cursor، Claude Code، Copilot…) بدهید؛ همهٔ اطلاعات لازم در آن هست و هیچ secret‌ای ندارد.`,
    unknownLocation: 'محل نامشخص',
    title: 'Fix Brief',
    savedTo: (path: string) => `Fix Brief ذخیره شد: ${path}`,
    copied: 'متن Fix Brief در clipboard کپی شد.',
    notCopied: 'clipboard در دسترس نبود؛ متن Fix Brief در ادامه آمده است.',
  },
  handoff: {
    title: 'اصلاح کد',
    mode: {
      self: 'خودت درستش کن (پیشنهاد اصلاح، تست و deploy با تأیید من)',
      handoff: 'بده به Agent من (Fix Brief می‌گیرم و خودم/Agentم اصلاح می‌کنیم)',
      report: 'فقط گزارش بده',
    } as Record<string, string>,
    choose: 'علت مشکل در کد است. چطور اصلاح شود؟',
    confirmSaved: (mode: string) =>
      `مثل دفعهٔ قبل؟ «${mode}»`,
    yes: 'بله',
    change: 'نه، روش دیگری انتخاب می‌کنم',
    waiting: 'منتظر commit اصلاح هستم (یا فراخوانی report_fix_done)…',
    pressEnter: 'وقتی اصلاح تمام شد Enter بزنید.',
    noChange: 'تغییری در فایل‌های پروژه ندیدم.',
    stillWaiting: 'incident باز می‌ماند تا اصلاح انجام شود.',
    newCommit: (message: string) =>
      `یک commit جدید دیدم: «${message}». بررسی و deploy کنم؟`,
    checkAndDeploy: 'بله، بررسی و deploy کن',
    later: 'فعلاً نه',
    validationFailed: (round: number) =>
      `اصلاح دور ${round} در بررسی محلی رد شد؛ Fix Brief جدید با خطای جدید آماده شد.`,
    capReached: (n: number) =>
      `بعد از ${n} دور اصلاح، مشکل هنوز حل نشده؛ گزارش incident را ببینید.`,
    reportOnly: 'فقط گزارش: تغییری در کد داده نمی‌شود؛ گزارش incident نوشته می‌شود.',
  },
  onFailure: {
    title: 'شکست deploy',
    kind: {
      preflight: 'مشکل پیش از ارسال کد',
      upload: 'آپلود کد قطع شد',
      build: 'ساخت (build) شکست خورد',
      timeout: 'نتیجهٔ deploy در زمان مقرر مشخص نشد',
      runtime: 'build موفق بود ولی اپ بالا نیامد',
    } as Record<string, string>,
    preflightHint: 'این مشکل پیش از ارسال کد است؛ موردی را که بالا گفته شد برطرف کنید و دوباره اجرا کنید.',
    retryQuestion: (n: number, max: number) =>
      `آپلود کد قطع شد. دوباره امتحان کنم؟ (تلاش ${n} از ${max} — آپلود دوباره امن است و فقط نسخهٔ جدیدی می‌سازد)`,
    retry: 'دوباره امتحان کن',
    notNow: 'نه، فعلاً',
    retriesExhausted: 'آپلود چند بار قطع شد؛ اتصال اینترنت را بررسی کنید و بعداً دوباره deploy کنید.',
    timeoutUnknown:
      'وضعیت deploy نامشخص است. این شکست حساب نمی‌شود و deploy دوباره‌ای هم خودکار انجام نمی‌شود.',
    timeoutQuestion: 'چه کار کنم؟',
    waitMore: (min: number) =>
      `${min} دقیقهٔ دیگر صبر کن`,
    inspect: 'لاگ و events را بررسی کن',
    leave: 'فعلاً رها کن',
    cameUp: 'اپ بالا آمد و پاسخ می‌دهد؛ نسخهٔ جدید فعال است.',
    stillPending: 'هنوز نتیجه‌ای نیامد.',
    rollbackQuestion: 'سایت شما الان پایین است؛ اول نسخهٔ سالم را برگردانم؟',
    rollbackYes: 'بله، اول نسخهٔ سالم را برگردان',
    rollbackNo: 'نه، مستقیم علت را بررسی کن',
    rollbackReason: 'نسخهٔ جدید بعد از deploy بالا نیامد',
    rolledBack: 'نسخهٔ سالم قبلی برگشت؛ حالا علت خرابی نسخهٔ جدید را بررسی می‌کنم.',
    noCodeFix: 'خطای build در کد است ولی مسیر اصلاح کد در دسترس نیست؛ خطا را در کد برطرف کنید و دوباره deploy کنید.',
    codeErrorTitle: 'خطای کامپایل در build',
    capReached: (n: number) =>
      `بعد از ${n} تلاش «اصلاح و deploy دوباره» متوقف شدم. کارهای امتحان‌شده:`,
    tried: {
      retry: 'آپلود دوباره',
      buildFix: (fix: string) => `اصلاح build: ${fix}`,
      codeFix: 'اصلاح کد',
      rollback: 'برگرداندن نسخهٔ سالم قبلی',
      sre: 'چرخهٔ عیب‌یابی (doctor)',
    },
    cleanupQuestion: 'اولین deploy موفق نشد. با منابعی که ساخته شد چه کنم؟',
    keep: 'نگه دار برای بعد',
    deleteAll: (cost: string) =>
      `همه را پاک کن (هزینهٔ روزانهٔ فعلی حدود ${cost})`,
    cleanupReason: (list: string, cost: string) =>
      `پاک‌سازی بعد از شکست اولین deploy — منابع ساخته‌شده: ${list} — هزینهٔ روزانه حدود ${cost}`,
    kept: 'منابع نگه داشته شد؛ هر وقت آماده بودید دوباره deploy کنید.',
    result: {
      recovered: 'deploy در نهایت موفق شد.',
      'rolled-back': 'نسخهٔ سالم قبلی برگشت.',
      unknown: 'وضعیت deploy هنوز نامشخص است.',
      stopped: 'deploy متوقف شد.',
      'gave-up': 'تلاش‌ها به سقف رسید و deploy متوقف شد.',
      cleaned: 'منابع ساخته‌شده پاک شد.',
    } as Record<string, string>,
  },
  doctor: {
    steps: {
      collect: 'جمع‌آوری وضعیت اپ',
      detect: 'تشخیص مشکلات',
      analyze: 'تحلیل لاگ‌ها',
      rca: 'یافتن علت',
      present: 'نمایش یافته‌ها',
      fix: 'اجرای راهکار و بررسی نتیجه',
      report: 'گزارش رخداد',
    } as Record<string, string>,
    healthy: (app: string) => `اپ «${app}» سالم است؛ مشکلی پیدا نشد.`,
    findingsTitle: (app: string) => `یافته‌های بررسی «${app}»`,
    problem: (t: string) => `مشکل: ${t}`,
    cause: (t: string, pct: number) => `علت محتمل: ${t} (اطمینان ${pct}٪)`,
    evidence: (items: string) => `شواهد: ${items}`,
    quick: (t: string) => `راهکار سریع: ${t}`,
    root: (t: string) => `راهکار ریشه‌ای: ${t}`,
    noFix: '—',
    choose: 'کدام راهکار اجرا شود؟',
    chooseQuick: (t: string) => `رفع سریع: ${t}`,
    chooseRoot: (t: string) => `رفع ریشه‌ای: ${t}`,
    chooseSkip: 'فعلاً هیچ‌کدام',
    askEnvName: 'نام متغیر محیطی‌ای که تنظیم نشده چیست؟ (در لاگ مشخص نبود)',
    badEnvName: 'نام متغیر فقط می‌تواند حروف انگلیسی، عدد و _ داشته باشد.',
    askEnvValue: (name: string) => `مقدار ${name} را وارد کنید:`,
    askEnvSecret: (name: string) => `مقدار ${name} را وارد کنید (نمایش داده نمی‌شود):`,
    noValue: (name: string) => `مقداری برای ${name} وارد نشد؛ راهکار اجرا نشد.`,
    manualTitle: 'اقدام دستی',
    roundTitle: (n: number, verdict: string) => `دور ${n}: ${verdict}`,
    skipped: 'راهکاری اجرا نشد؛ گزارش با وضعیت «منتظر اصلاح» ثبت شد.',
    noCodeFix: 'برای اصلاح کد، مسیر پروژه و مدل زبانی لازم است؛ از راهنمای دستی استفاده کنید.',
    notSupported: 'این راهکار هنوز به‌صورت خودکار پشتیبانی نمی‌شود؛ راهنمای دستی نمایش داده شد.',
    diagnoseTool: 'بررسی کامل اپ تا مرحلهٔ پیشنهاد راهکار (بدون هیچ تغییری)',
    fixTool: 'اجرای راهکار انتخاب‌شده از آخرین بررسی و راستی‌آزمایی نتیجه',
    noDiagnosis: 'اول با diagnose_app اپ را بررسی کنید.',
  },
  incident: {
    title: (app: string, id: string) => `گزارش رخداد «${app}» (${id})`,
    sections: {
      summary: 'خلاصه',
      impact: 'اثر',
      timeline: 'خط زمانی',
      rootCause: 'علت ریشه‌ای',
      evidence: 'شواهد',
      actions: 'اقدامات',
      verification: 'نتیجهٔ راستی‌آزمایی',
      prevention: 'پیشگیری در آینده',
    },
    kind: { runtime: 'مشکل در حال اجرا', 'deploy-failure': 'شکست deploy', 'build-failure': 'شکست build' } as Record<string, string>,
    status: { open: 'باز', 'waiting-fix': 'منتظر اصلاح', resolved: 'رفع‌شده', 'gave-up': 'رهاشده (نیاز به بررسی انسانی)' } as Record<string, string>,
    severity: { critical: 'بحرانی', warn: 'هشدار', info: 'اطلاع' } as Record<string, string>,
    meta: (kind: string, status: string, severity: string, opened: string, closed: string) =>
      `نوع: ${kind} · وضعیت: ${status} · شدت: ${severity} · شروع: ${opened} · پایان: ${closed}`,
    defaultSummary: (n: number, top: string) => `${n} مشکل تشخیص داده شد؛ مهم‌ترین: ${top}.`,
    noSignals: 'مشکلی تشخیص داده نشد.',
    defaultImpact: (signals: string) => `علائم مشاهده‌شده: ${signals}`,
    noRootCause: 'علت ریشه‌ای مشخص نشد.',
    confidence: (n: number) => `اطمینان: ${n}٪`,
    noActions: 'اقدامی انجام نشد.',
    actionLine: (time: string, title: string, risk: string, result: string) => `${time} — ${title} (${risk}) — نتیجه: ${result}`,
    notVerified: 'راستی‌آزمایی انجام نشد.',
    verdict: (v: string) => `حکم: ${v}`,
    tableHead: '| شاخص | قبل | بعد |',
    prevention: {
      code: 'برای این مسیر یک تست خودکار اضافه کنید تا پیش از deploy خطا گرفته شود.',
      config: 'متغیرهای محیطی لازم را در بررسی اولیهٔ deploy چک کنید و در .env.example مستند کنید.',
      resource: 'برای مصرف حافظه و CPU هشدار تعریف کنید و پلن را با بار واقعی هماهنگ کنید.',
      dependency: 'وابستگی‌ها را در dependencies (نه devDependencies) نگه دارید و lockfile را commit کنید.',
      platform: 'وضعیت سرویس‌های لیارا و تنظیمات اپ را بعد از هر تغییر بررسی کنید.',
      network: 'گواهی‌ها و تنظیمات DNS را پیش از انقضا پایش کنید.',
      generic: 'بعد از هر deploy، بررسی سلامت خودکار (health check) را اجرا کنید.',
    } as Record<string, string>,
    footer: (when: string) => `این گزارش به‌صورت خودکار توسط siavash-agent در ${when} ساخته شد. مقادیر محرمانه حذف شده‌اند.`,
  },
  verifyFix: {
    verdict: { resolved: 'رفع شد', improved: 'بهتر شد', unchanged: 'تغییری نکرد', worse: 'بدتر شد' } as Record<string, string>,
    metric: {
      availability: 'دسترس‌پذیری (٪)',
      errorRate: 'نرخ خطای 5xx (٪)',
      p95: 'زمان پاسخ p95 (ms)',
      memory: 'مصرف حافظه',
      critical: 'هشدارهای بحرانی',
      target: 'مشکل هدف',
    } as Record<string, string>,
    present: 'هست',
    absent: 'نیست',
    nextUndo: 'اوضاع بدتر شده؛ پیشنهاد: فوراً تغییر را برگردانید (undo) یا به نسخهٔ سالم قبلی rollback کنید.',
    nextHypothesis: 'این راهکار اثری نداشت؛ سراغ فرضیهٔ بعدی می‌رویم.',
    giveUp: 'بعد از چند دور تلاش مشکل رفع نشد؛ گزارش کامل برای بررسی انسانی آماده می‌شود.',
    keepWatching: 'بهتر شده ولی کامل رفع نشده؛ کمی بعد دوباره بررسی می‌کنیم.',
    done: 'مشکل رفع شد.',
  },
  patch: {
    invalid: (n: number) =>
      `اصلاحیهٔ پیشنهادی بعد از یک بار تصحیح هم معتبر نبود (${n} مشکل)؛ تغییری اعمال نشد.`,
    empty: 'مدل هیچ تغییری پیشنهاد نکرد.',
    dirtyFiles: (files: string) =>
      `این فایل‌ها تغییرات commit‌نشده دارند: ${files}. اول آن‌ها را commit یا stash کنید تا کار شما از بین نرود.`,
    cardTitle: (app: string) =>
      `اعمال اصلاح کد روی «${app}»`,
    cardImpact: (rootCause: string, tests: string, diff: string) =>
      `علت: ${rootCause}\nنتیجهٔ تست محلی: ${tests}\n\nتغییرات:\n${diff}`,
    cardRollbackGit: (branch: string) =>
      `تغییرات روی branch جداگانهٔ ${branch} است؛ با برگشت به branch اصلی یا rollback برمی‌گردد.`,
    cardRollbackBackup: 'نسخهٔ قبلی فایل‌ها در .siavash/backups نگه داشته شده است.',
    testsPassed: 'همهٔ بررسی‌ها موفق بود',
    testsSkipped: 'اسکریپت تست یا build در پروژه پیدا نشد',
    testsFailed: (names: string) =>
      `ناموفق: ${names}`,
    validationFailed: (rounds: number) =>
      `اصلاحیه بعد از ${rounds} دور تلاش هنوز تست‌های محلی را رد می‌کند؛ همهٔ تغییرات برگردانده شد.`,
    rejected: 'اصلاحیه تأیید نشد؛ همهٔ تغییرات برگردانده شد.',
    startTitle: (app: string) =>
      `تهیهٔ اصلاح کد برای «${app}»`,
    startImpact:
      'یک اصلاحیه ساخته و روی یک branch جداگانه به‌صورت محلی تست می‌شود. commit و deploy فقط بعد از تأیید جداگانه با دیدن diff انجام می‌شود.',
    startRollback: 'اگر تأیید نکنید، همهٔ تغییرات محلی برگردانده می‌شود.',
    toolDescription: 'اصلاح خودکار باگ کد: ساخت اصلاحیه، تست محلی، تأیید با diff، commit و deploy',
  },
  remediate: {
    action: {
      set_env: (name: string) => `تنظیم متغیر محیطی ${name}`,
      restart_app: () => 'ری‌استارت اپ',
      resize_app: (plan: string) => `ارتقای پلن به ${plan}`,
      rollback_app: () => 'برگشت به آخرین نسخهٔ سالم',
      redeploy_app: () => 'deploy دوباره از کد فعلی',
      code_patch: () => 'اصلاح کد و deploy نسخهٔ جدید',
      config_file: () => 'اصلاح فایل پیکربندی پروژه',
      set_read_only: () => 'خاموش کردن حالت فقط‌خواندنی فایل‌سیستم',
      create_disk: () => 'ساخت دیسک پایدار',
      run_migration: () => 'اجرای migration داخل کانتینر',
      manual: () => 'اقدام دستی',
    } as Record<string, (x: string) => string>,
    quick: 'رفع سریع',
    root: 'رفع ریشه‌ای',
    choosePlan: 'پلن جدید باید انتخاب شود.',
    manualIntro: 'این کار را باید خودتان انجام دهید:',
    manualStep: (n: number, text: string) => `${n}. ${text}`,
    manualCheck: (how: string) => `بعد از انجام، بررسی کنید: ${how}`,
    manualAsk: 'اگر کمک لازم شد، نتیجه را برای من بنویسید تا ادامه دهیم.',
  },
  containerProbes: {
    notAllowed: (id: string) =>
      `بررسی «${id}» در فهرست دستورات مجاز نیست؛ فقط دستورات فقط‌خواندنی از پیش‌تعریف‌شده اجرا می‌شوند.`,
    badArg: (id: string) =>
      `ورودی بررسی «${id}» معتبر نیست.`,
    title: (app: string, n: number) =>
      `اجرای ${n} بررسی فقط‌خواندنی داخل کانتینر «${app}»`,
    reason: 'تأیید یا رد فرضیه‌های علت مشکل',
    impact: 'به کانتینر اپ وصل می‌شود و فقط دستورات فقط‌خواندنی زیر را اجرا می‌کند؛ چیزی تغییر نمی‌کند.',
    rollback: 'نیازی به برگشت نیست؛ این دستورات چیزی را تغییر نمی‌دهند.',
    toolDescription: 'اجرای بررسی‌های فقط‌خواندنی از پیش‌تعریف‌شده داخل کانتینر (نام envها، دیسک، حافظه، پردازه‌ها، DNS و اتصال به دیتابیس)',
  },
  logAnalyzer: {
    llmUnavailable:
      'تحلیل هوشمند لاگ در دسترس نبود؛ فقط الگوهای شناخته‌شده گزارش شدند.',
  },
  healthScore: {
    label: { healthy: 'سالم', attention: 'نیاز به توجه', critical: 'بحرانی' } as Record<string, string>,
    allGood: (app: string) =>
      `اپ «${app}» سالم است و مشکلی پیدا نشد.`,
    problems: (app: string, n: number, top: string) =>
      `در اپ «${app}» ${n} مشکل پیدا شد؛ مهم‌ترین: ${top}.`,
    partial: (sources: string) =>
      ` (بخشی از اطلاعات دریافت نشد: ${sources})`,
    toolDescription: 'بررسی سلامت اپ: جمع‌آوری وضعیت، اجرای آشکارسازها و امتیاز ۰ تا ۱۰۰',
  },
  overview: {
    sourceFailed: 'این بخش دریافت نشد.',
    probeSkipped: 'بررسی پاسخ‌گویی درخواست نشد.',
    toolDescription: 'نمای کلی اپ: وضعیت، پلن، آخرین deploy، env، دامنه‌ها، دیسک‌ها، مصرف، رویدادها و پاسخ‌گویی',
  },
  pipeline: {
    stepFailed: (title: string) =>
      `مرحلهٔ «${title}» با خطا متوقف شد.`,
    cancelled:
      'عملیات به درخواست شما بین دو مرحله متوقف شد؛ با --resume از همان‌جا ادامه می‌دهیم.',
    resumed: (title: string) =>
      `ادامه از مرحلهٔ «${title}».`,
  },
  planner: {
    catalogUnavailable:
      'فهرست پلن‌های لیارا دریافت نشد. مطمئن شوید CLI لیارا نصب است و توکن درست است، سپس دوباره تلاش کنید.',
    catalogEmpty:
      'لیارا هیچ پلنی برنگرداند؛ بدون فهرست پلن‌ها نمی‌توان هزینه را محاسبه کرد.',
    unknownPlan: (id: string) =>
      `پلن «${id}» در فهرست پلن‌های لیارا پیدا نشد.`,
    priceUnknown: (what: string) =>
      `قیمت ${what} از لیارا در دسترس نیست و در جمع هزینه حساب نشده است.`,
    dbLabel: 'دیتابیس',
    diskLabel: 'دیسک',
    noAvailablePlan:
      'هیچ پلن قابل‌استفاده‌ای در فهرست لیارا پیدا نشد.',
    reasonEconomy: (ramMb: number) =>
      `ارزان‌ترین پلنی که حداقل حافظهٔ لازم برای این نوع پروژه (${ramMb}MB) را دارد؛ برای تست و دمو مناسب است.`,
    reasonRecommended: (ramMb: number, why: string) =>
      `ارزان‌ترین پلنی که نیاز برآوردشده (${ramMb}MB حافظه) را پوشش می‌دهد. ${why}`,
    reasonPerformance:
      'یک پله بالاتر از پیشنهاد اصلی؛ برای ترافیک بیشتر یا اطمینان بیشتر در production.',
    reasonTopPlan:
      'بزرگ‌ترین پلن موجود؛ نیاز برآوردشده از همهٔ پلن‌ها بیشتر است.',
    whyGoalProduction: 'برای production حافظهٔ بیشتری در نظر گرفته شد.',
    whyTraffic: (level: string) =>
      `ترافیک مورد انتظار «${level}» در نظر گرفته شد.`,
    whyLargeProject: 'حجم پروژه زیاد است.',
    whyBase: 'بر اساس نوع پروژه.',
    upgradeNotNeeded: (mem: string, cpu: string) =>
      `مصرف فعلی (حافظه ${mem}، CPU ${cpu}) در محدودهٔ پلن فعلی است؛ ارتقا لازم نیست.`,
    upgradeTo: (plan: string, what: string) =>
      `پیشنهاد: ارتقا به ${plan}، چون مصرف ${what} از ۸۰٪ پلن فعلی بیشتر است.`,
    upgradeAtTop: (what: string) =>
      `مصرف ${what} بالاست اما پلن فعلی بزرگ‌ترین پلن موجود است؛ بهینه‌سازی برنامه یا افزایش scale را بررسی کنید.`,
    memoryWord: 'حافظه',
    cpuWord: 'CPU',
    unknownWord: 'نامعلوم',
    pct: (v: number) => `${v}٪`,
    and: ' و ',
  },
  report: {
    unknownPlatform:
      'نوع پروژه تشخیص داده نشد؛ نمی‌دانم با چه پلتفرمی روی لیارا اجرا شود.',
    unknownPlatformFix:
      'مطمئن شوید در پوشهٔ درست هستید، یا یک Dockerfile به پروژه اضافه کنید.',
    platformUnverified: (platform: string) =>
      `شناسهٔ پلتفرم «${platform}» در لیارا هنوز تأیید نشده است.`,
    platformUnverifiedFix:
      'پیش از deploy شناسهٔ پلتفرم با لیارا بررسی می‌شود؛ در صورت نیاز از Dockerfile استفاده کنید.',
    missingEnv: (names: string) =>
      `این متغیرهای محیطی لازم هستند و مقدارشان مشخص نیست: ${names}`,
    missingEnvFix:
      'مقدار این متغیرها را پیش از deploy وارد کنید.',
    llmFindingFix:
      'این مورد را بررسی کنید؛ تحلیل خودکار آن را تأیید نکرده است.',
    llmUnavailable:
      'تحلیل هوشمند در دسترس نبود؛ فقط نتیجهٔ تحلیل خودکار نمایش داده می‌شود.',
  },
  deps: {
    ephemeralFs: (what: string) =>
      `برنامه فایل ذخیره می‌کند (${what})؛ فایل‌سیستم کانتینر پایدار نیست و با هر deploy یا restart پاک می‌شود.`,
    ephemeralFsFix: (folder: string) =>
      `یک دیسک لیارا بسازید و آن را به پوشهٔ «${folder}» متصل کنید.`,
    sqlite:
      'از SQLite استفاده می‌شود؛ فایل دیتابیس در کانتینر پایدار نمی‌ماند.',
    sqliteFix:
      'از دیتابیس مدیریت‌شدهٔ لیارا (PostgreSQL/MySQL) استفاده کنید یا فایل SQLite را روی دیسک نگه دارید.',
    migration: (command: string) =>
      `این پروژه migration دارد؛ بعد از deploy باید اجرا شود: ${command}`,
    migrationFix:
      'Agent بعد از deploy (با تأیید شما) migration را داخل کانتینر اجرا می‌کند.',
  },
  opsEnv: {
    setTitle: (app: string, n: number) =>
      `تنظیم ${n} متغیر محیطی روی «${app}»`,
    unsetTitle: (app: string, n: number) =>
      `حذف ${n} متغیر محیطی از «${app}»`,
    defaultReason:
      'به درخواست شما',
    diffLine: (key: string, change: string) =>
      `${key}: ${change}`,
    added: 'افزوده می‌شود',
    changed: 'تغییر می‌کند',
    removed: 'حذف می‌شود',
    restartYes:
      'تغییر env باعث ری‌استارت اپ می‌شود.',
    restartUnknown:
      'ممکن است تغییر env باعث ری‌استارت اپ شود (رفتار لیارا هنوز تأیید نشده).',
    restartNo:
      'تغییر env اپ را ری‌استارت نمی‌کند.',
    rollbackSet:
      'مقادیر قبلی ذخیره می‌شوند و با دستور undo برمی‌گردند.',
    rollbackUnset:
      'مقادیر حذف‌شده در فایل امن نگه داشته می‌شوند و با undo برمی‌گردند.',
    noChange:
      'هیچ تغییری لازم نیست؛ مقادیر از قبل همین هستند.',
  },
  rollback: {
    title: (app: string) =>
      `برگرداندن «${app}» به نسخهٔ سالم قبلی`,
    defaultReason:
      'نسخهٔ فعلی مشکل دارد',
    impact: (from: string, to: string, method: string) =>
      `از ${from}\nبه ${to}\nروش: ${method}`,
    describe: (id: string, when: string, commit: string | undefined) =>
      `استقرار ${id.slice(0, 8)} (${when}${commit ? `، commit ${commit.slice(0, 7)}` : ''})`,
    methodSource:
      'ساخت release جدید از همان سورس قبلی (سریع)',
    methodGitApi:
      'ساخت دوباره از commit قبلی در git و استقرار با API',
    methodGitCli:
      'ساخت دوباره از commit قبلی در git و استقرار با CLI',
    rollbackFa:
      'در صورت نیاز می‌توانید دوباره به نسخهٔ فعلی برگردید (در تاریخچه ثبت می‌شود).',
    noTarget:
      'نسخهٔ سالم قبلی برای برگشت پیدا نشد.',
    noMethod:
      'هیچ روشی برای برگشت در دسترس نیست (سورس قبلی و commit گیت ثبت نشده است).',
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
    justNow: 'همین الان',
    ago: (s: string) => `${s} پیش`,
    later: (s: string) => `${s} دیگر`,
    invalidDuration:
      'قالب مدت‌زمان نامعتبر است (نمونهٔ درست: 30s، 5m، 1h، 2d).',
  },
  domains: {
    exists: (name: string) => `دامنهٔ «${name}» قبلاً ثبت شده است.`,
  },
  knowledge: {
    invalid: 'فایل پایگاه دانش خطاها (patterns.yaml) نامعتبر است.',
    notFound: 'فایل پایگاه دانش خطاها (patterns.yaml) پیدا نشد.',
    unknownValue: '؟',
  },
  format: {
    toman: 'تومان',
    byteUnits: ['بایت', 'کیلوبایت', 'مگابایت', 'گیگابایت', 'ترابایت'],
    percent: '٪',
    thousandsSep: '٬',
    decimalSep: '٫',
  },
} as const;

export type Fa = typeof fa;
