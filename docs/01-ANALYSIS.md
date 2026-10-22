# تحلیل پروژه — چالش لیارا (هکاتون) — تیم سیاوش

> این فایل «چرا» و «چه» را توضیح می‌دهد. «چگونه» (تسک‌ها) در `03-TASKS.md` است و قوانین کار Agentها در `02-AGENT_RULES.md`.

---

## ۱. خلاصهٔ مسئله

باید یک **Agent** بسازیم که دو نقش دارد:

1. **Deploy Agent (راهنمای استقرار):** برنامه‌نویسی که هیچ چیز از deploy نمی‌داند، فقط پروژه‌اش را می‌دهد و Agent:
   پروژه را تحلیل می‌کند → موجودی حساب لیارا را چک می‌کند (اگر کم بود از کاربر می‌خواهد شارژ کند) → پلن مناسب را پیشنهاد و **تأیید می‌گیرد** → اپ را می‌سازد → متغیرهای محیطی را تنظیم می‌کند → deploy می‌کند → سلامت را چک می‌کند → دامنه و SSL را وصل می‌کند.
2. **SRE Agent (مهندس پایداری):** وقتی سایت کند شد / خطا داد / از کار افتاد:
   لاگ‌ها و متریک‌ها را می‌خواند → خطا را تشخیص می‌دهد → علت‌های محتمل را با **شواهد** ارائه می‌دهد → راهکار پیشنهاد می‌کند → (با تأیید) اصلاح می‌کند؛ چه در سطح زیرساخت (restart، resize، env، rollback) چه در سطح کد (با **Coding Agent**: ساخت patch، تست، redeploy) → **نتیجهٔ اصلاح را راستی‌آزمایی می‌کند**.

قید کلیدی: **Human-in-the-loop**. هیچ اقدام حساسی بدون تأیید کاربر انجام نمی‌شود. پایش ۲۴ساعته لازم نیست، اما پایش «در لحظه / به درخواست» و چک دوره‌ای کوتاه‌مدت یک امتیاز است.

قالب تحویل آزاد است (Agent کامل / MCP / ...). **UX مهم‌تر از UI است.** ویدیوی دمو با چند سناریو الزامی است.

---

## ۲. تصمیم‌های معماری (و دلیلشان)

| # | تصمیم | دلیل |
|---|---|---|
| D1 | **TypeScript + Node.js 22**، یک پکیج واحد (نه monorepo) | تخصص تیم؛ نمونهٔ BoxAPI هم TS است؛ پکیج واحد Agentهای کدنویس را گیج نمی‌کند. |
| D2 | **یک هسته (core) + دو رابط:** CLI چت‌محور (رابط اصلی دمو) و **MCP Server** (همان ابزارها) | با یک کد، هم «Agent کامل» تحویل می‌دهیم هم «نسخهٔ MCP» — هر دو گزینهٔ داورها پوشش داده می‌شود. |
| D3 | **فرایندهای حساس به‌صورت State Machine قطعی** (deploy pipeline، remediation loop)، و LLM فقط برای فهم نیت، تحلیل لاگ، توضیح و تولید patch | Agentهایی که LLM آزادانه API می‌زند در دمو خراب می‌شوند. ترکیب «مسیر قطعی + هوش LLM» هم پایدار است هم هوشمند. |
| D4 | **لایهٔ ایمنی مرکزی (Safety Gate):** هر ابزار یک سطح ریسک دارد (R0..R3) و اجرای آن فقط از مسیر Gate ممکن است | معیار «مدیریت تأیید کاربر» و «مدیریت امن اقدامات حساس» مستقیماً امتیاز دارد. |
| D5 | **Deploy دوحالته:** حالت API (`/v2/.../sources` → `/v2/.../releases`) و حالت CLI (`liara deploy --api-token`). بقیهٔ عملیات با **REST API**؛ و فقط آنچه API ندارد (کاتالوگ پلن، خواندن env، دیتابیس، لاگ زنده) با CLI | حالت API امتیاز «اتصال به API» را صریح می‌کند؛ حالت CLI لاگ build زنده دارد و پشتیبان مطمئن است. |
| D10 | **دفتر deploy محلی (ledger)** به‌جای لیست release، و **rollback = release جدید با sourceID قبلی** (یا بیلد دوباره از git commit قبلی) | API لیارا لیست، وضعیت و rollback ِ release ندارد (نگاه کنید به `04-LIARA_API_MAP.md §4`). |
| D6 | **حالت Mock** (`LIARA_MODE=mock`) با fixtureهای واقعیِ ضبط‌شده | Agentهای کدنویس بدون توکن و بدون هزینه بتوانند تست بنویسند و اجرا کنند. |
| D7 | **LLM از BoxAPI** با لایهٔ سازگاری: اگر tool calling بومی کار نکرد، پروتکل JSON دستی | پشتیبانی مدل‌ها از tool calling/JSON مشخص نیست (مستند BoxAPI). |
| D8 | **همهٔ پیام‌های کاربر به فارسی**، شناسه‌ها/کد به انگلیسی | کاربر هدف فارسی‌زبان است؛ «قابل‌فهم بودن پیشنهادها» امتیاز دارد. |
| D11 | **سه حالت fix کد:** خود Agent (self)، تحویل به Agent کاربر با Fix Brief و MCP (handoff)، فقط گزارش (report) | بسیاری از برنامه‌نویس‌ها نمی‌خواهند ابزار بیرونی کدشان را تغییر دهد؛ Agent خودشان پروژه را بهتر می‌شناسد. Agent ما تشخیص، deploy و راستی‌آزمایی را نگه می‌دارد. |
| D9 | **Audit log** برای هر اقدام + **Incident Report** برای هر مشکل | هم امنیت/نگهداری را نشان می‌دهد هم در ویدیوی دمو قابل نمایش است. |

---

## ۳. نمای کلی معماری

```
                 ┌─────────────────────────┐      ┌──────────────────────┐
  کاربر ───────▶ │  CLI چت (siavash)        │      │  MCP Server (stdio)  │ ◀── Claude/Cursor
                 └────────────┬────────────┘      └──────────┬───────────┘
                              ▼                              ▼
                 ┌──────────────────────────────────────────────────────┐
                 │ Agent Core: intent router · agent loop · session     │
                 │  └ LLM client (BoxAPI) + model router + JSON fallback │
                 ├──────────────────────────────────────────────────────┤
                 │ Tool Registry (zod schema + risk level + handler)     │
                 ├───────────────┬──────────────┬───────────────────────┤
                 │ Deploy        │ Ops/Service  │ SRE                    │
                 │ Orchestrator  │ Management   │ health·metrics·logs    │
                 │ analyzer·plan │ restart·env  │ detectors·RCA          │
                 │ advisor·domain│ resize·rollbk│ remediation·verify     │
                 │               │ backup       │ Coding Agent (patch)   │
                 ├───────────────┴──────────────┴───────────────────────┤
                 │ Safety Gate: risk · approval · redaction · audit ·     │
                 │              dry-run · rate-limit awareness            │
                 ├──────────────────────────────────────────────────────┤
                 │ Liara Integration: REST · CLI · console(WS) · ledger · mock │
                 └──────────────────────────────────────────────────────┘
```

### ساختار پوشه‌ها (قطعی — همهٔ تسک‌ها به همین ارجاع می‌دهند)

```
siavash-agent/
├─ docs/                      # این فایل‌ها + LLM_COMPAT.md + OPEN_QUESTIONS.md + API_LIMITS.md
├─ specs/                     # OpenAPI ِ لیارا (دانلودشده در T0.1)
├─ fixtures/liara/            # پاسخ‌های واقعیِ redact‌شده برای mock
├─ scripts/                   # llm-smoke.ts, record-fixtures.ts, demo-*.sh
├─ demo-apps/                 # اپ‌های نمونه (سالم و باگ‌دار) برای سناریوهای دمو
├─ src/
│  ├─ config/                 # env, models.json loader
│  ├─ shared/                 # errors, result types, logger, time utils
│  ├─ liara/
│  │  ├─ http.ts              # HTTP client پایه
│  │  ├─ api/                 # apps.ts, metrics.ts, disks.ts, domains.ts, billing.ts, account.ts, logs.ts, releases.ts, dbaas.ts
│  │  ├─ cli.ts               # wrapper ِ @liara/cli
│  │  └─ mock/                # mock server/adapter
│  ├─ safety/                 # risk.ts, approval.ts, redact.ts, audit.ts
│  ├─ llm/                    # client.ts, router.ts, json-protocol.ts, prompts/
│  ├─ tools/                  # registry.ts + یک فایل برای هر گروه ابزار
│  ├─ agent/                  # loop.ts, intent.ts, session.ts
│  ├─ analyzer/               # detect-platform.ts, detect-env.ts, detect-port.ts, report.ts
│  ├─ planner/                # plans.ts, recommend.ts, cost.ts
│  ├─ deploy/                 # pipeline.ts (state machine), steps/*.ts
│  ├─ ops/                    # service.ts, env.ts, releases.ts, backups.ts, domains.ts
│  ├─ sre/                    # health.ts, metrics.ts, logs.ts, detectors/, rca.ts, remediate.ts, verify.ts, incident.ts, watch.ts
│  ├─ coder/                  # context.ts, patch.ts, apply.ts, validate.ts
│  ├─ runbooks/               # runbook engine + runbookهای آماده
│  ├─ ui/cli/                 # index.ts, render/*.ts, prompts.ts, i18n/fa.ts
│  └─ mcp/                    # server.ts
├─ tests/                     # unit + integration (mock) + e2e
├─ .env.example
└─ package.json
```

---

## ۴. سطوح ریسک و سیاست تأیید (قلب Human-in-the-loop)

| سطح | نوع | مثال | رفتار |
|---|---|---|---|
| **R0** | فقط‌خواندنی | لیست اپ‌ها، لاگ، متریک، billing، plan list | بدون تأیید |
| **R1** | تغییر برگشت‌پذیر | restart، start، ساخت اپ، set env غیرمحرمانه، deploy نسخهٔ جدید، backup | کارت تأیید (بله/خیر) |
| **R2** | تغییر با **هزینه** یا اثر قابل‌توجه | انتخاب/تغییر پلن، resize، ساخت دیتابیس/دیسک، set env محرمانه، rollback، اعمال patch کد | کارت تأیید **با نمایش هزینه، اثر و راه برگشت** |
| **R3** | مخرب / غیرقابل‌برگشت | حذف اپ/دیسک/دیتابیس/دامنه، env unset، stop اپ production | تأیید با **تایپ نام اپ** |

کارت تأیید همیشه این‌ها را نشان می‌دهد: **چه کاری · چرا · روی چه منبعی · هزینه (اگر دارد) · ریسک · راه برگشت · دستور/API دقیق**.
در MCP: ابزارهای R1+ دومرحله‌ای‌اند (`plan` → `confirm_token` → `execute`).
حالت `--dry-run` همه چیز را نشان می‌دهد ولی هیچ تغییری اجرا نمی‌کند.

مراحلی که **فقط انسان** می‌تواند انجام دهد (API ندارد) و Agent باید صریحاً اعلام کند و منتظر بماند:
شارژ حساب لیارا · خرید دامنه · تنظیم DNS/nameserver در ثبت‌کنندهٔ دامنه.

---

## ۵. جریان‌های اصلی

### ۵.۱ Deploy از صفر (`siavash deploy ./my-app`)
1. **Preflight:** توکن معتبر؟ CLI لیارا نصب است؟ (اگر نه، راهنمایی نصب)
2. **Analyze:** تشخیص پلتفرم (node/next/react-static/python-django/flask/php-laravel/docker/static)، نسخه، پورت، دستور build/start، env های لازم (از `.env.example` و اسکن کد)، نیاز به دیتابیس (از وابستگی‌ها: `pg`, `mysql2`, `mongoose`, `prisma`, ...)، نیاز به دیسک (آپلود فایل).
3. **Report:** خلاصهٔ فارسی تحلیل + مواردی که مطمئن نیست → سؤال از کاربر (حداکثر چند سؤال).
4. **Plan advice:** پلن پیشنهادی + یک گزینهٔ ارزان‌تر و یک گزینهٔ قوی‌تر با دلیل و هزینه.
5. **Billing check:** موجودی کافی است؟ اگر نه → پیام «لطفاً X تومان شارژ کنید» + لینک پنل + **poll موجودی** تا کافی شود.
6. **Approval (R2):** تأیید پلن و خلاصهٔ کارها.
7. **Execute:** ساخت اپ → (دیتابیس/دیسک در صورت نیاز، با تأیید جدا) → set env (مقادیر محرمانه با ورودی پنهان) → ساخت `liara.json` → deploy.
8. **Verify:** وضعیت اپ، health probe HTTP، بررسی لاگ‌های شروع؛ اگر شکست خورد → **SRE به‌صورت خودکار وارد می‌شود**.
9. **Domain (اختیاری):** افزودن دامنه → نمایش رکورد CNAME برای ثبت‌کننده → صبر/بررسی → فعال‌سازی SSL.
10. **Summary:** URL، پلن، هزینهٔ ماهانه، دستورهای مفید بعدی.

نمایش وضعیت: یک چک‌لیست زنده از مراحل (⏳ / ✅ / ❌ / ⏸ منتظر تأیید).

### ۵.۲ چرخهٔ SRE (`siavash doctor <app>` یا «سایتم کند شده»)
1. **Collect:** وضعیت اپ، متریک (CPU/RAM/شبکه)، summary دیسک، لاگ‌های اخیر، تاریخچهٔ release، health probe (زمان پاسخ و کد HTTP).
2. **Detect:** (شامل events اپ و بررسی فقط‌خواندنی داخل کانتینر با console)
    آشکارسازهای قطعی (rule-based) → فهرست «سیگنال‌ها» با شدت.
3. **Diagnose (RCA):** پایگاه الگوی خطا + LLM → ۱ تا ۳ فرضیه، هر کدام با **شواهد (خط لاگ/متریک)**، اطمینان (٪)، و دسته (code / config / resource / dependency / platform).
4. **Propose:** برای هر فرضیه راهکار مشخص + سطح ریسک + اثر مورد انتظار.
5. **Approve & Fix:** اقدام زیرساختی یا Coding Agent (patch → تست → diff → تأیید → commit → redeploy).
6. **Verify:** اندازه‌گیری مجدد در یک پنجرهٔ زمانی و مقایسهٔ قبل/بعد → «حل شد / بهتر شد / حل نشد». اگر بدتر شد → پیشنهاد rollback.
7. **Report:** Incident Report در `reports/incidents/<id>.md` (و HTML).

### ۵.۳ وقتی deploy شکست می‌خورد (T5.11)
| نوع | رفتار |
|---|---|
| preflight | توقف + راهنمایی |
| upload | پیشنهاد تکرار با تأیید (حداکثر ۲ بار) |
| build | تحلیل لاگ build → اگر کد: انتخاب حالت fix؛ اگر پیکربندی: پیشنهاد تغییر تنظیمات |
| timeout | «وضعیت نامشخص» — صبر بیشتر یا بررسی؛ هرگز deploy تکراری خودکار |
| runtime در redeploy | **اول rollback فوری** به نسخهٔ سالم، بعد تشخیص علت |
| runtime در اولین deploy | چرخهٔ SRE |

سقف ۳ تلاش برای زنجیرهٔ fix و redeploy. بعد از آن توقف و گزارش کامل. اگر اولین deploy شکست خورد و کاربر منصرف شد، پاک‌سازی منابع پیشنهاد می‌شود.

### ۵.۴ وقتی مشکل در کد کاربر است (T8.14، T8.15)
Agent سه گزینه می‌دهد و انتخاب ذخیره می‌شود:
1. **خودت درستش کن:** patch → تست محلی → diff → تأیید → commit → redeploy → verify.
2. **بده به Agent من:** یک **Fix Brief** (مشکل، شواهد، محل مشکوک، روش بازتولید، معیار پذیرش، محدودیت‌ها) به‌صورت فایل، clipboard و ابزار MCP تحویل می‌شود. Agent کاربر (Cursor یا Claude Code) کد را درست و commit می‌کند و از طریق MCP `report_fix_done` را صدا می‌زند، یا Agent ما commit جدید را خودش تشخیص می‌دهد. بعد: اعتبارسنجی محلی → (در صورت نقص، brief دور دوم) → redeploy → verify.
3. **فقط گزارش بده:** Incident Report.

### ۵.۵ پایش به‌درخواست (`siavash watch <app> --interval 1m --duration 30m`)
Poll دوره‌ای health/metrics/logs، نمایش داشبورد ترمینالی، و در صورت عبور از آستانه → شروع خودکار چرخهٔ SRE (تشخیص خودکار، اصلاح فقط با تأیید).

---

## ۶. نگاشت معیارهای داوری به ویژگی‌ها (برای اطمینان از پوشش کامل)

| معیار (امتیاز) | زیرمعیار | ویژگی/ماژول | تسک‌ها |
|---|---|---|---|
| **عملکرد فنی و یکپارچگی (۱۰۰)** | اتصال به API لیارا | REST client کامل، خطاها، retry | T1.* |
| | راه‌اندازی و دیپلوی | Analyzer، Plan Advisor، Deploy Pipeline، مدیریت شکست، Domain/SSL | T4.*, T5.* |
| | مدیریت سرویس | restart/scale/resize/env/rollback/backup/disk/settings | T6.* |
| | اجرای موفق عملیات زیرساختی | waitForState + E2E روی لیارای واقعی + verify | T1.2, T5.8, T11.2–T11.3 |
| **هوشمندی و حل مسئله (۱۰۰)** | تحلیل لاگ | Log parser + خوشه‌بندی + events + لاگ build | T8.1–T8.3, T8.13 |
| | تشخیص خطا | Detectors + readiness قبل از deploy + حافظهٔ رخداد | T7.5, T4.8, T8.16 |
| | علل احتمالی | RCA با شواهد و اطمینان + بررسی داخل کانتینر | T8.4, T8.5 |
| | ارائهٔ راهکار | Remediation planner + Coding Agent + handoff به Agent کاربر | T8.6–T8.9, T8.14, T8.15 |
| | بررسی نتیجهٔ اقدامات | Verify loop قبل/بعد + smoke test + بنچمارک Eval | T8.10, T7.9, T11.11 |
| **تجربهٔ کاربری (۵۰)** | سادگی تعامل | یک دستور، چت فارسی، سؤال کم | T9.* |
| | قابل‌فهم بودن پیشنهادها | قالب ثابت «مشکل / علت / شواهد / راهکار» | T8.11, T9.4 |
| | نمایش وضعیت عملیات | چک‌لیست زنده، داشبورد watch، پنل وب | T9.3, T7.7, T9.10 |
| | مدیریت تأیید کاربر | کارت تأیید R1–R3 | T2.2, T9.5 |
| **پایداری، نگهداری، امنیت (۵۰)** | پایش سلامت سرویس و منابع | health score، watch، آستانه‌ها، مشاور هزینه | T7.*, T6.9 |
| | خودکارسازی عملیات تکراری | Runbooks + scheduled check | T10.1–T10.3 |
| | مدیریت امن اقدامات حساس | Safety Gate، redaction، audit، dry-run | T2.* |
| | اعلام محدودیت‌های API | API_LIMITS.md + دستور `limits` + پیام شفاف در خطا | T10.4–T10.5 |

---

## ۷. سناریوهای ویدیوی دمو (باید همه‌شان قبل از تحویل واقعاً اجرا شوند)

| # | سناریو | چه چیزی را نشان می‌دهد |
|---|---|---|
| S1 | Deploy یک اپ Node/Express از صفر، با کم بودن موجودی → درخواست شارژ → ادامه | deploy، billing، human-in-the-loop، plan advice |
| S2 | اپ بعد از deploy crash می‌کند چون `DATABASE_URL` تنظیم نشده | تشخیص env گمشده از لاگ → set env (R2) → restart → verify |
| S3 | Endpoint با باگ کد خطای 500 می‌دهد (TypeError) | Coding Agent: patch → تست → diff → تأیید → redeploy → verify |
| S4 | نشت حافظه / OOM → restartهای پشت‌سرهم | متریک RAM + لاگ → پیشنهاد resize (با هزینه) + پیشنهاد fix کد |
| S5 | Release جدید خراب است | تشخیص ارتباط زمانی خطا با release → rollback (R2) → verify |
| S6 | اتصال دامنه + SSL | نمایش CNAME، مرحلهٔ انسانی، فعال‌سازی SSL |
| S7 | تلاش برای حذف اپ | کارت R3 با تایپ نام، audit log |
| S9 | Redeploy نسخهٔ خراب روی سایت سالم | rollback فوری و برگشت سایت، بعد تشخیص علت → fix → deploy موفق |
| S10 | باگ کد با همکاری دو Agent | Fix Brief → Claude Code یا Cursor از طریق MCP fix و commit می‌کند → Agent ما deploy و راستی‌آزمایی می‌کند |
| S8 (bonus) | همین کارها از داخل Claude Desktop / Cursor با MCP | انعطاف قالب تحویل |

---

## ۸. ناشناخته‌ها و ریسک‌ها (در فاز ۰ باید روشن شوند)

منبع حقیقت endpointها `04-LIARA_API_MAP.md` است. این موارد هنوز مبهم‌اند و **T0.5 (fixture)** و **T0.8 (spike روی اپ آزمایشی)** باید جوابشان را پیدا کنند:

1. `update-envs` کل مجموعه را **جایگزین** می‌کند یا **merge**؟ آیا اپ را restart می‌کند؟ (تا روشن شدن: همیشه «خواندن کل → merge → ارسال کل»)
2. بعد از `POST /v2/.../releases`، پایان و نتیجهٔ build از چه سیگنالی معلوم می‌شود؟ (events / logs / status / isDeployed / probe)
3. آیا release جدید با `sourceID` قدیمی ساخته می‌شود؟ (امکان rollback سریع)
4. فرمت `since` در لاگ (string) و متریک (number)؛ واحد CPU و RAM.
5. ساختار `values` در events و انواع رویدادها.
6. مقادیر `status` اپ و زمان رسیدن به وضعیت پایدار بعد از restart، scale و delete (این عملیات ناهمگام‌اند).
7. نام فیلدهای `GET /v1/billing` و ساختار `liara plan:list --output json`.
8. آدرس پیش‌فرض اپ (`<name>.liara.run`؟) و نحوهٔ ارسال `teamID` در REST.
9. وجود endpointهای اضافه در `paas.yaml` و جزئیات اتصال دیتابیس در `dbaas.yaml`.
10. Rate limitهای لیارا و BoxAPI؛ پشتیبانی مدل‌های BoxAPI از tool calling و JSON mode (T0.2).

نتیجهٔ همهٔ این‌ها در `docs/liara/BEHAVIOR.md` و `docs/OPEN_QUESTIONS.md` ثبت می‌شود.
