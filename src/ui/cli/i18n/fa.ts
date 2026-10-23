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
    // TODO(T5.11): replaced by the deploy-failure decision machine.
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
