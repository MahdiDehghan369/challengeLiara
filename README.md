# سیاوش — همکار فنی deploy و SRE روی لیارا

سیاوش یک دستیار هوشمند است که برنامه‌نویسی را که چیزی از deploy نمی‌داند، از **اولین deploy روی لیارا** تا **پایش، عیب‌یابی و رفع مشکل** همراهی می‌کند — و هر کار حساسی را **فقط با تأیید خود کاربر** انجام می‌دهد (Human-in-the-Loop).

سه راه استفاده، روی یک موتور مشترک:

| رابط | دستور | برای چه کسی |
|---|---|---|
| **گفتگوی فارسی در ترمینال** | `siavash` | «سایتم کند شده»، «پروژه‌ام را deploy کن» |
| **دستورات CLI** | `siavash deploy` · `siavash doctor shop` · `siavash limits` | کار سریع و اسکریپت |
| **پنل وب** | `siavash ui` (روی لیارا هم deploy می‌شود) | دمو، تأیید با دکمه، دیدن سلامت اپ‌ها |
| **MCP Server** | `siavash mcp` | Claude Code / Cursor / Claude Desktop — Agent کدنویسی کاربر |

---

## شروع سریع (۳ دستور)

```bash
pnpm install && pnpm build
node dist/ui/cli/index.js login        # توکن API لیارا (یک بار؛ در ~/.siavash/credentials با دسترسی 600)
node dist/ui/cli/index.js deploy ./my-project
```

بدون حساب لیارا هم می‌توانید همه‌چیز را ببینید: `LIARA_MODE=mock` (پیش‌فرض) یک لیارای شبیه‌سازی‌شده با ۸ سناریوی خرابی بالا می‌آورد.

```bash
LIARA_MODE=mock node dist/ui/cli/index.js ui     # آدرس پنل با توکن یک‌بارمصرف چاپ می‌شود
```

### متغیرهای محیطی

| متغیر | مقدار |
|---|---|
| `LIARA_API_TOKEN` | توکن API از پنل لیارا (یا `siavash login`) |
| `LIARA_TEAM_ID` | اختیاری، برای حساب تیمی |
| `LIARA_MODE` | `live` = لیارای واقعی · `mock` = شبیه‌سازی |
| `BOXAPI_API_KEY` / `LLM_MODE` | مدل زبانی (BoxAPI، سازگار با OpenAI) · `mock` بدون هزینه |
| `SIAVASH_UI_TOKEN` | توکن ورود به پنل وب (اجباری وقتی پنل روی اینترنت است) |

---

## سناریوها (همان چیزی که در ویدیو می‌بینید)

1. **اولین deploy** — `siavash deploy`: پروژه تحلیل می‌شود (پلتفرم، پورت، اسکریپت‌ها، envهای لازم، دیتابیس) → پلن مناسب با هزینهٔ ماهانه پیشنهاد می‌شود → **کارت تأیید** → موجودی حساب چک می‌شود (اگر کم بود: لینک شارژ و صبر) → ساخت اپ، env، دیسک → آپلود و build با چک‌لیست زنده → بررسی سلامت بعد از deploy → کارت خلاصه با آدرس.
2. **دامنه** — `siavash domain list`؛ لایهٔ API دامنه، SSL و بررسی DNS ([src/liara/api/domains.ts](src/liara/api/domains.ts)، [src/liara/dns.ts](src/liara/dns.ts)) آماده است، اما جریان کامل «وصل کردن دامنه + راهنمای ایرنیک» هنوز به CLI وصل نشده (T5.9).
3. **سایت کند/خطای 500** — `siavash doctor shop` یا «سایت shop کند شده»: جمع‌آوری موازی شواهد (وضعیت، CPU/RAM نسبت به سقف پلن، لاگ، رویدادها، پروب HTTP) → ۱۶ آشکارساز قطعی → خوشه‌بندی لاگ + ۵۳ الگوی خطای شناخته‌شده → **علت‌های محتمل رتبه‌بندی‌شده با درصد اطمینان و شاهد** → راهکار سریع (مثلاً ری‌استارت/افزایش پلن) و راهکار ریشه‌ای (اصلاح کد) → تأیید → اجرا → **بررسی نتیجه با جدول قبل/بعد** → گزارش رخداد (Markdown/HTML).
4. **باگ در کد** — سیاوش یک **Fix Brief** برای Agent کدنویسی کاربر می‌سازد (از طریق MCP: `get_fix_brief` → اصلاح → `report_fix_done`) یا خودش patch پیشنهاد می‌دهد؛ بعد redeploy و verify.
5. **build شکست خورد** — تحلیل لاگ build (اسکریپت گم‌شده، نسخهٔ Node، خطای TypeScript، lockfile، OOM) و اصلاح پروژه‌محور.
6. **انتشار نسخهٔ جدید / rollback** — `siavash redeploy` و `siavash rollback` (از دفتر deployهای محلی، چون لیارا API rollback ندارد).

---

## Human-in-the-Loop: سطوح ریسک

| سطح | نمونه | رفتار |
|---|---|---|
| **R0** خواندنی | وضعیت، لاگ، متریک، عیب‌یابی | خودکار |
| **R1** کم‌ریسک | ری‌استارت، start، redeploy، set env معمولی | کارت تأیید (یک کلیک / `y`) |
| **R2** پرهزینه/اثرگذار | تغییر پلن (با تفاوت هزینه)، stop، env محرمانه، IP ثابت | کارت تأیید با هزینه و اثر |
| **R3** برگشت‌ناپذیر | حذف اپ/دیسک، stop اپ production | باید **نام اپ را تایپ کنید** |

- ریسک فقط بالا می‌رود (`escalate`): اپ‌های production/protected، کلیدهای محرمانه، حذف env.
- `--yes` هرگز R2/R3 را تأیید نمی‌کند؛ اجرای headless فقط R0.
- هر اقدام (تأییدشده، ردشده، dry-run، خطا) در `audit.jsonl` ثبت می‌شود؛ مقدارهای محرمانه redact می‌شوند و برای undo جدا ذخیره می‌شوند.
- در MCP و پنل وب، تأیید دومرحله‌ای است: پاسخ اول `approval_required` + توکن یک‌بارمصرف ۵ دقیقه‌ای که به همان ابزار+پارامترها گره خورده.
- `--dry-run` همه‌جا: فقط نشان می‌دهد چه کاری انجام می‌شد.

---

## معماری

```
 کاربر ── گفتگو / CLI / پنل وب / MCP (Agent کدنویسی)
                 │
          Intent router + Agent loop (LLM با tool-calling، بودجه و loop-breaker)
                 │
          Tool Registry (۴۰+ ابزار، هر کدام با ریسک ثابت)
                 │
          Safety Gate: risk escalate → policy → Approver → audit
        ┌────────┼──────────────┬───────────────┬──────────────┐
     deploy/   ops/          sre/             coder/        planner/
   pipeline   restart,      snapshot →       fix brief,    پلن و هزینه
   + failure  resize, env,  detectors →      patch, apply,
   policy     domain, disk  log analyzer →   revert
                            RCA → remediate → verify → incident
                 │
          Liara client: REST (fetch + retry/backoff/429) · liara CLI · console WS · mock (msw)
```

| پوشه | نقش |
|---|---|
| [src/liara](src/liara) | اتصال به API لیارا، CLI لیارا، ledger deployها، شبیه‌ساز کامل |
| [src/safety](src/safety) | ریسک، تأیید، policy، audit، redact، بودجهٔ درخواست |
| [src/deploy](src/deploy) | pipeline گام‌به‌گام deploy و تصمیم‌گیری هنگام شکست |
| [src/sre](src/sre) | آشکارسازها، تحلیل لاگ، RCA مبتنی بر شاهد، اصلاح، verify، گزارش رخداد |
| [src/analyzer](src/analyzer) / [src/planner](src/planner) | تحلیل پروژه و پیشنهاد پلن |
| [src/coder](src/coder) | Fix Brief و patch کد |
| [src/mcp](src/mcp) · [src/ui/web](src/ui/web) · [src/ui/cli](src/ui/cli) | رابط‌ها |
| [src/limits/catalog.ts](src/limits/catalog.ts) | کاتالوگ محدودیت‌ها (CLI، ابزار LLM و پنل از همین می‌خوانند) |

---

## اتصال به APIهای لیارا

- پایه: `https://api.liara.ir` با هدر `Authorization: Bearer <LIARA_API_TOKEN>` (و `teamID` برای حساب تیمی).
- [src/liara/http.ts](src/liara/http.ts): timeout، retry فقط برای GET (429/502/503/504) با backoff و `Retry-After`، پیام خطای فارسی برای هر status.
- جاهایی که REST وجود ندارد از **liara CLI** استفاده می‌شود (`env:list`، `plan:list`، `db`، `logs -f`، `deploy`) — توکن در لاگ‌ها scrub می‌شود.
- فهرست کامل endpointها: [docs/liara/ENDPOINTS.md](docs/liara/ENDPOINTS.md). مهم‌ترین‌ها:

| گروه | Endpoint |
|---|---|
| اپ‌ها | `GET/POST /v1/projects` · `DELETE /v1/projects/{name}` · `POST …/actions/scale` · `POST …/actions/restart` · `POST …/resize` |
| deploy | `POST /v2/projects/{name}/sources` (tar.gz) · `POST /v2/projects/{name}/releases` |
| پایش | `GET …/metrics/summary` · `…/metrics/cpu` · `…/metrics/memory` · `GET …/logs` · `GET …/events` |
| تنظیمات | `POST /v1/projects/update-envs` · zero-downtime · default-subdomain · fixed-ip · read-only |
| دیسک و backup | `/v1/projects/{id}/disks…` |
| دامنه | `/v1/domains…` + SSL |
| مالی | `GET /v1/billing` (موجودی قبل از ساخت/تغییر پلن) |

---

## محدودیت‌ها (و راه جایگزین ما)

کامل: [docs/API_LIMITS.md](docs/API_LIMITS.md) · در برنامه: `siavash limits` یا تب «محدودیت‌ها» در پنل. خلاصه:

- **فقط انسانی:** شارژ حساب، خرید دامنه، تغییر DNS نزد ثبت‌کننده → سیاوش مقدار دقیق را می‌گوید، صبر می‌کند و بعد خودش تأیید می‌کند.
- **شکاف API:** جزئیات اپ، فهرست release، rollback، خواندن env، کاتالوگ قیمت، زمان پاسخ routeها → list+filter، ledger محلی، CLI لیارا، پروب HTTP خودمان.
- **رفتار نامعلوم:** replace/merge در update-envs، تأیید پایان restart → read-merge-write و poll وضعیت واقعی.
- **rate limit:** backoff + بودجهٔ درخواست در هر جلسه.
- **LLM:** هر فرضیه باید شاهد داشته باشد؛ لاگ‌ها قبل از ارسال redact می‌شوند.
- **عامل:** پایش ۲۴/۷ نیست (به درخواست یا `watch` کوتاه)؛ تشخیص احتمالی است و با verify قبل/بعد سنجیده می‌شود.

سؤال‌های باز API با شناسه در [docs/OPEN_QUESTIONS.md](docs/OPEN_QUESTIONS.md).

---

## دیپلوی پنل روی لیارا

پنل وب سیاوش خودش روی لیارا (پلتفرم Docker) اجرا می‌شود: [Dockerfile](Dockerfile) و [liara.json](liara.json).

```bash
liara app:create --app siavash-panel --platform docker --plan <پلن>
liara env:set SIAVASH_UI_TOKEN=<یک رشتهٔ تصادفی طولانی> --app siavash-panel
# برای کار روی حساب واقعی (اختیاری): LIARA_MODE=live LIARA_API_TOKEN=... ؛ پیش‌فرض mock است
liara deploy --app siavash-panel --port 3000 --platform docker
```

سپس: `https://siavash-panel.liara.run/?token=<SIAVASH_UI_TOKEN>`. بدون توکن، همهٔ APIها 401 می‌دهند.

---

## نگاشت معیارهای داوری به ویژگی‌ها

| معیار | کجا |
|---|---|
| **اتصال به API و deploy (۱۰۰)** | [src/liara](src/liara) · [src/deploy/pipeline.ts](src/deploy/pipeline.ts) · [src/ops](src/ops) · ledger و rollback |
| **هوشمندی و حل مسئله (۱۰۰)** | [src/sre/detectors](src/sre/detectors) · [src/sre/log-analyzer.ts](src/sre/log-analyzer.ts) · [src/sre/rca.ts](src/sre/rca.ts) · [src/sre/remediate.ts](src/sre/remediate.ts) · [src/sre/verify.ts](src/sre/verify.ts) · [src/sre/build-doctor.ts](src/sre/build-doctor.ts) |
| **تجربهٔ کاربری (۵۰)** | گفتگوی فارسی [src/ui/cli/chat.ts](src/ui/cli/chat.ts) · چک‌لیست زنده و کارت‌ها [src/ui/cli/render](src/ui/cli/render) · پنل وب [src/ui/web](src/ui/web) · خطاهای قابل‌فهم [src/ui/cli/errors.ts](src/ui/cli/errors.ts) |
| **پایداری و امنیت (۵۰)** | [src/safety](src/safety) (ریسک، تأیید، audit، redact، policy، بودجه) · health score [src/sre/health-score.ts](src/sre/health-score.ts) · [src/limits/catalog.ts](src/limits/catalog.ts) |

## اپ‌های دموی خراب

[demo-apps/](demo-apps): `node-missing-env`، `node-http500`، `node-memleak`، `node-slow`، `node-build-fail`، `node-bad-release`، `node-db`، `static-ok`، `node-express-ok` — هر کدام README دارد: باگ چیست و سیاوش باید چه تشخیصی بدهد.

## توسعه

```bash
pnpm typecheck && pnpm lint && pnpm test     # همهٔ تست‌ها روی لیارای mock، بدون هزینه
```

مستندات بیشتر: [docs/01-ANALYSIS.md](docs/01-ANALYSIS.md) (تحلیل)، [docs/MCP_SETUP.md](docs/MCP_SETUP.md) (اتصال به Claude/Cursor)، [docs/PROGRESS.md](docs/PROGRESS.md) (وضعیت تسک‌ها).
