# قوانین کار برای Coding Agentها — پروژهٔ siavash-agent

> این فایل را در ابتدای **هر** جلسه به Agent بدهید، همراه با تسکی که باید انجام دهد.
> نمونهٔ پرامپت شروع:
> «فایل‌های `docs/01-ANALYSIS.md`، `docs/02-AGENT_RULES.md` و `docs/liara/04-LIARA_API_MAP.md` را بخوان. سپس فقط تسک `T3.2` از `docs/03-TASKS.md` را انجام بده. وقتی تمام شد معیارهای پذیرش را یکی‌یکی چک کن و `docs/PROGRESS.md` را به‌روز کن.»

## ۱. قوانین طلایی
1. **فقط یک تسک در هر جلسه.** کاری خارج از محدودهٔ تسک انجام نده. اگر چیزی لازم بود که در تسک نیست، در `docs/PROGRESS.md` بخش «پیشنهاد تسک جدید» بنویس.
2. **حدس نزن.** هیچ endpoint، فیلد پاسخ، نام پلن یا رفتار API را از خودت نساز. منبع مجاز به ترتیب اولویت: `docs/liara/04-LIARA_API_MAP.md` (نقشهٔ endpointها)، `docs/liara/BEHAVIOR.md` (رفتارهای کشف‌شده)، `specs/*.yaml`، `fixtures/`، `docs/OPEN_QUESTIONS.md`. **endpointهایی که وجود ندارند (جزئیات اپ، لیست release، rollback، خواندن env) را نساز**؛ راهبرد جایگزین در §4 نقشه آمده است. اگر نبود → در `docs/OPEN_QUESTIONS.md` سؤال اضافه کن، کد را پشت یک interface بنویس و با `TODO(OQ-<n>)` علامت بزن.
3. **قبل از کدنویسی:** وابستگی‌های تسک را چک کن (در `PROGRESS.md` باید ✅ باشند). اگر نبودند، متوقف شو و گزارش بده.
4. **بعد از کدنویسی:** `pnpm typecheck && pnpm lint && pnpm test` باید سبز باشد. تست‌های خواسته‌شده در تسک را حتماً بنویس.
5. **یک commit برای هر تسک** با پیام: `T<id>: <عنوان کوتاه انگلیسی>`.
6. **هیچ secret در کد، لاگ، fixture یا commit.** توکن‌ها فقط از `.env`. fixtureها باید redact شوند (`scripts/redact-fixture.ts`).
7. **هیچ اقدام تغییردهنده‌ای روی لیارا بدون عبور از `safety/approval.ts`.** هیچ ابزاری مستقیم `liara/api/*` تغییردهنده را صدا نمی‌زند مگر از طریق Tool Registry.
8. **تست‌ها با mock اجرا می‌شوند** (`LIARA_MODE=mock`, `LLM_MODE=mock`). تست‌هایی که لیارای واقعی را می‌زنند فقط در `tests/e2e/` و با `RUN_E2E=1`.

9. **`{name}` و `{id}` را قاطی نکن.** هر endpoint که `{id}` می‌خواهد از `resolveApp(name)` استفاده کند.
10. **عملیات ناهمگام** (restart، scale، delete) فقط «ثبت شد» برمی‌گردانند؛ نتیجه را همیشه با `waitForState` تأیید کن.

## ۲. استانداردهای کد
- TypeScript strict، ESM، Node 22. پکیج‌منیجر: **pnpm**.
- کتابخانه‌های مجاز (چیز دیگری اضافه نکن مگر تسک بگوید): `zod`, `openai`, `commander`, `@clack/prompts`, `picocolors`, `ora`, `cli-table3`, `execa`, `undici` (یا fetch بومی), `pino`, `dotenv`, `yaml`, `diff`, `simple-git`, `@modelcontextprotocol/sdk`, `tar`, `ws`, `vitest`, `msw`, `eslint`, `prettier`, `tsx`.
- خطاها: فقط کلاس‌های `src/shared/errors.ts` (`LiaraApiError`, `ValidationError`, `ApprovalDeniedError`, `RateLimitError`, `ExternalCommandError`, `LlmError`).
- توابعی که ممکن است شکست بخورند در لایهٔ ابزار، `Result<T>` برمی‌گردانند (`{ ok: true, data } | { ok: false, error }`).
- هر پاسخ API با **zod** اعتبارسنجی می‌شود؛ مقادیر عددیِ string به عدد تبدیل می‌شوند.
- تمام متن‌های کاربرپسند در `src/ui/cli/i18n/fa.ts` (فارسی). در کد منطق، متن فارسی hardcode نکن.
- لاگ داخلی با `pino` و redaction فعال. `console.log` فقط در `src/ui/`.
- نام فایل‌ها kebab-case، نام توابع camelCase، تایپ‌ها PascalCase.
- هر ماژول یک `index.ts` با export عمومی دارد.

## ۳. تعریف «انجام‌شده» (Definition of Done)
- [ ] همهٔ معیارهای پذیرش تسک برقرار است.
- [ ] تست‌های خواسته‌شده نوشته و سبزند.
- [ ] typecheck و lint سبز.
- [ ] secretی در diff نیست.
- [ ] `docs/PROGRESS.md` به‌روز شده (وضعیت ✅، فایل‌های تغییرکرده، نکات).
- [ ] اگر چیزی از API کشف شد، در `docs/OPEN_QUESTIONS.md` یا `docs/API_LIMITS.md` ثبت شد.

## ۴. قالب `docs/PROGRESS.md`
```
| Task | Status | Commit | Notes |
|------|--------|--------|-------|
| T0.1 | ✅ | abc123 | paas.yaml دانلود شد؛ 47 endpoint |
| T0.2 | 🚧 | - | gpt-6-astra tool calling ندارد |
```
وضعیت‌ها: ⬜ شروع‌نشده · 🚧 در حال انجام · ✅ تمام · ⛔ مسدود (دلیل در Notes)

## ۵. اگر گیر کردی
- اگر تست به دلیل ناشناخته بودن API نمی‌تواند نوشته شود → با fixture ِ موجود بنویس و `it.todo` برای حالت ناشناخته.
- اگر تسک بزرگ‌تر از انتظار بود → بخش‌های انجام‌شده را commit کن، بقیه را در PROGRESS به‌عنوان `T<id>-b` پیشنهاد بده.
- هرگز برای سبز کردن تست، تست را حذف یا `skip` نکن.
