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
  tools: {
    unknownTool: (name: string) => `ابزار «${name}» وجود ندارد.`,
    invalidInput: (name: string) => `ورودی ابزار «${name}» نامعتبر است.`,
    readTitle: (name: string) => `اجرای ابزار فقط‌خواندنی «${name}»`,
    readImpact: 'فقط اطلاعات خوانده می‌شود؛ چیزی تغییر نمی‌کند.',
    noRollback: 'نیازی به برگشت نیست.',
    defaultReason: 'درخواست Agent',
  },
  llm: {
    allModelsFailed: 'هیچ‌کدام از مدل‌های زبانی این نقش پاسخ ندادند؛ کمی بعد دوباره تلاش کنید.',
    toolsNeedJsonProtocol: 'مدل این نقش از فراخوانی مستقیم ابزار پشتیبانی نمی‌کند؛ باید از پروتکل JSON استفاده شود.',
    noMockRule: 'برای این درخواست در MockLlm قانونی تعریف نشده است.',
    badJsonReply: 'مدل زبانی دو بار پاسخ نامعتبر داد (JSON قابل‌فهم نبود)؛ درخواست را دوباره امتحان کنید.',
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
