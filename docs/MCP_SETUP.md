# راه‌اندازی MCP Server سیاوش

با `siavash mcp` همهٔ ابزارهای سیاوش (deploy، عیب‌یابی، مدیریت اپ و …) از راه پروتکل MCP روی stdio در دسترس Agentهایی مثل Claude Desktop، Claude Code و Cursor قرار می‌گیرد.

## پیش‌نیاز

1. سیاوش ساخته شده باشد: `pnpm install && pnpm build` (فایل اجرایی: `dist/ui/cli/index.js`).
2. توکن لیارا را **در فایل پیکربندی MCP ننویسید**. یک بار در ترمینال اجرا کنید:

   ```
   siavash login
   ```

   توکن در `~/.siavash/credentials` (فقط قابل خواندن برای خودتان) ذخیره می‌شود و MCP Server همان را می‌خواند. اگر ترجیح می‌دهید، فایل `.env` در پوشهٔ پروژه هم کار می‌کند.
3. `LIARA_MODE=live` لازم است تا روی لیارای واقعی کار کند؛ پیش‌فرض `mock` است (لیارای شبیه‌سازی‌شده، بدون هیچ تغییر واقعی).

## Claude Desktop

در فایل `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "siavash": {
      "command": "node",
      "args": ["C:/path/to/siavash/dist/ui/cli/index.js", "mcp"],
      "env": {
        "LIARA_MODE": "live",
        "SIAVASH_PROJECT_DIR": "C:/path/to/my-project"
      }
    }
  }
}
```

`SIAVASH_PROJECT_DIR` پوشهٔ پروژهٔ شماست (Fix Briefها در `.siavash/fix-briefs` همین پوشه ساخته می‌شوند). Claude Desktop را دوباره باز کنید.

## Cursor

فایل `.cursor/mcp.json` در ریشهٔ پروژه:

```json
{
  "mcpServers": {
    "siavash": {
      "command": "node",
      "args": ["C:/path/to/siavash/dist/ui/cli/index.js", "mcp"],
      "env": { "LIARA_MODE": "live", "SIAVASH_PROJECT_DIR": "${workspaceFolder}" }
    }
  }
}
```

## Claude Code

```
claude mcp add siavash -e LIARA_MODE=live -e SIAVASH_PROJECT_DIR=$(pwd) -- node /path/to/siavash/dist/ui/cli/index.js mcp
```

## تأیید دومرحله‌ای (مهم)

- ابزارهای فقط‌خواندنی (R0) مثل `list_apps` و `app_overview` بلافاصله اجرا می‌شوند.
- هر ابزاری که چیزی را تغییر می‌دهد (R1 به بالا)، در فراخوانی اول **اجرا نمی‌شود** و این را برمی‌گرداند:

  ```json
  { "status": "approval_required", "risk": "R1", "plan": "<کارت فارسی: چه، چرا، هزینه، ریسک، راه برگشت، دستور دقیق>", "confirm_token": "…" }
  ```

  Agent باید کارت را به شما نشان دهد و **فقط اگر شما تأیید کردید** همان ابزار را با همان آرگومان‌ها و `confirm_token` دوباره صدا بزند. توکن ۵ دقیقه اعتبار دارد، یک‌بارمصرف است و اگر آرگومان‌ها عوض شوند رد می‌شود.
- اقدامات برگشت‌ناپذیر (R3، مثل `delete_app`) علاوه بر توکن، `confirm_app_name` می‌خواهند: نام اپ را **خودتان** تایپ کنید.
- وقتی کاری به قدم یا پاسخ شما نیاز دارد (مثلاً نام اپ در اولین deploy، شارژ حساب یا DNS)، پاسخ `status: "waiting_human"` همراه با سؤال است. اولین deploy یک پروژه چند سؤال دارد؛ آن را با `siavash deploy` در ترمینال انجام دهید. `redeploy_app` و بقیهٔ ابزارها از MCP کامل کار می‌کنند.

## همکاری با Agent برنامه‌نویسی شما

وقتی علت مشکل در کد است، `fix_issue` به‌جای اصلاح خودکار یک **Fix Brief** می‌سازد و رخداد در وضعیت `waiting-fix` می‌ماند:

1. `list_open_incidents()` — رخدادهای باز
2. `get_fix_brief({incidentId})` — متن کامل کار (یا prompt آمادهٔ `fix-incident`)
3. Agent شما کد را اصلاح و commit می‌کند
4. `report_fix_done({incidentId, commit})`
5. `redeploy_app` (با تأیید دومرحله‌ای) و بعد `diagnose_app` برای بررسی نتیجه
6. `get_incident_status({incidentId})` — وضعیت

Resourceها: `liara://apps` و `siavash://incidents/<id>`. Promptها: `deploy-my-project`، `diagnose-my-site`، `fix-incident`.

## بررسی با MCP Inspector

```
npx @modelcontextprotocol/inspector node dist/ui/cli/index.js mcp
```

با `LIARA_MODE=mock` (پیش‌فرض) همه‌چیز روی لیارای شبیه‌سازی‌شده اجرا می‌شود و هیچ منبع واقعی‌ای ساخته یا تغییر داده نمی‌شود.
