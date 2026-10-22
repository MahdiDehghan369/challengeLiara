# نقشهٔ API لیارا — منبع حقیقت برای Agentها

> این فایل از مستندات رسمی PaaS API، Billing و Liara CLI که تیم فراهم کرده استخراج شده.
> **هر endpointی که اینجا نیست، وجود ندارد** تا وقتی که در `specs/*.yaml` پیدا شود (T0.1) یا در spike (T0.8) تأیید شود.
> Base: `https://api.liara.ir` · Auth: `Authorization: Bearer <API_TOKEN>` · تیم: پارامتر `teamID` (نحوهٔ ارسال در REST باید در T0.8 تأیید شود).

## ۱. نکتهٔ حیاتی: `{name}` در برابر `{id}`
- `{name}` = نام اپ (`project_id` در پاسخ لیست).
- `{id}` = شناسهٔ داخلی اپ (`_id` در پاسخ لیست).
- همیشه با `resolveApp(name) → {id, name}` کار کن. استفادهٔ اشتباه = 404.

## ۲. endpointهای موجود

### Apps
| عمل | Method/Path | ورودی | خروجی | نکته |
|---|---|---|---|---|
| لیست اپ‌ها | `GET /v1/projects` | — | `{projects:[{_id, project_id, type, status, scale, planID, created_at, isDeployed}]}` | **endpoint جزئیات یک اپ وجود ندارد** → لیست + فیلتر |
| ساخت اپ | `POST /v1/projects` | `{name, planID, platform, readOnlyRootFilesystem?, network?}` | 200 | 409 = نام تکراری |
| حذف اپ | `DELETE /v1/projects/{name}` | — | 200 «ثبت شد» / 204 | **ناهمگام** → poll تا حذف از لیست |
| روشن/خاموش | `POST /v1/projects/{name}/actions/scale` | `{scale: 1 \| 0}` | 200 «ثبت شد» | ناهمگام |
| ری‌استارت | `POST /v1/projects/{name}/actions/restart` | — | 200 «ثبت شد» | ناهمگام |
| تغییر پلن | `POST /v1/projects/{name}/resize` | `{planID}` | 200 | |
| لاگ‌ها | `GET /v1/projects/{name}/logs?since=<string>` | `since` الزامی («timestamp») | `[{type, datetime, message}]` | فرمت since در T0.8 تأیید شود؛ صفحه‌بندی ندارد |
| رویدادها | `GET /v1/projects/{name}/events?search&start&end` | start/end = unix ثانیه | `{data:[{metaData:{}, values:[[string]]}]}` | ساختار values در T0.8 کشف شود |

### Deploy
| عمل | Method/Path | ورودی | خروجی |
|---|---|---|---|
| آپلود سورس | `POST /v2/projects/{name}/sources` | `multipart/form-data` با `file` (فایل `.gz` — یعنی tar.gz) | `{sourceID}` |
| ساخت release | `POST /v2/projects/{name}/releases` | `{sourceID, port, type}` (type = پلتفرم) | `{releaseID}` |

**وجود ندارد:** لیست releaseها، وضعیت release/build، لاگ build، rollback.

### Settings (همه با `{id}`؛ `{status}` = `enable` یا `disable`)
| عمل | Path | خروجی |
|---|---|---|
| Zero-downtime | `POST /v1/projects/{id}/zero-downtime/{status}` | 200 / 409 |
| زیردامنهٔ پیش‌فرض | `POST /v1/projects/{id}/default-subdomain/{status}` | 200 / 409 |
| IP ثابت | `POST /v1/projects/{id}/fixed-ip/{status}` | `{IP}` |
| فایل‌سیستم read-only | `POST /v1/projects/{id}/read-only/{status}` | 200 / 409 |
| به‌روزرسانی env | `POST /v1/projects/update-envs` | body `{project:<name>, variables:[{key, value}]}` → `{message}` |

**وجود ندارد:** خواندن env از API → فقط `liara env:list -a <app> --output json`.
**ناشناخته:** آیا `update-envs` کل مجموعه را جایگزین می‌کند یا merge؟ آیا اپ را restart می‌کند؟ → T0.8.

### Reports (متریک، با `{name}`)
| عمل | Path | ورودی | خروجی |
|---|---|---|---|
| خلاصه | `GET /v1/projects/{name}/metrics/summary` | — | `{cpuUsage:[{value, applet}], memoryUsage:[...], disksUsage:[{size, usage, reportedAt, name}]}` |
| CPU / Memory / Net-RX / Net-TX | `GET /v1/projects/{name}/metrics/{cpu\|memory\|network-receive\|network-transmit}` | `since` (number، الزامی) | `{end, result:[{values:[[ts, v]], applet}]}` |

مقادیر ممکن است string باشند. واحدها و معنای since → T0.8.

### Disks / Backups / FTP
| عمل | Method/Path | ورودی | خروجی |
|---|---|---|---|
| لیست دیسک‌ها | `GET /v1/projects/{id}/disks` | — | `{disks:[{_id,name,size,updatedAt,createdAt}], mounts:[{name, mountedTo}]}` |
| ساخت دیسک | `POST /v1/projects/{name}/disks` | `{name, size: string}` | 201 |
| resize دیسک | `POST /v1/projects/{name}/disks/{dname}/resize` | `{size: string}` | 200 |
| حذف دیسک | `DELETE /v1/projects/{id}/disks/{name}` | — | 200 / 409 |
| لیست backup | `GET /v1/projects/{id}/disks/{name}/backups` | — | `{backups:[{name,lastModified,etag,size}]}` |
| ساخت backup | `POST /v1/projects/{id}/disks/{name}/backups` | — | 200 |
| لینک دانلود backup | `POST /v1/projects/{id}/disks/{dname}/backups/{bname}/download` | — | `{link}` |
| لیست FTP | `GET /v1/projects/{name}/disks/{dname}/ftp` | — | `{accesses:[{_id, username, password, readOnly,...}], host}` ⚠️ شامل پسورد |
| ساخت FTP | `POST /v1/projects/{name}/disks/{dname}/ftp` | `{username, readOnly}` | `{username, password, host}` ⚠️ |
| حذف FTP | `DELETE /v1/ftp/{fname}` | — | 200 |

### Domains / SSL
| عمل | Method/Path | ورودی | خروجی |
|---|---|---|---|
| لیست دامنه‌های اپ | `GET /v1/domains?project=<name>` | — | `{domains:[{_id, name, type, project, status, certificatesStatus, redirectTo, redirectStatus, created_at, CNameRecord}]}` |
| ساخت دامنه | `POST /v1/domains` | `{name, project, type:"PROJECT"}` | 201 `{domain:{_id}}` / 409 |
| اتصال دامنه به اپ | `POST /v1/domains/set-project` | `{domainID, projectID}` | 200 |
| ریدایرکت | `POST /v1/domains/{id}/set-redirect` | `{redirectStatus: 301\|302, redirectTo}` | 200 |
| فعال‌سازی SSL | `POST /v1/domains/provision-ssl-certs` | `{domain}` | `{code}` |
| غیرفعال‌سازی SSL | `POST /v1/domains/{id}/ssl/disable` | — | 204 |
| حذف دامنه | `DELETE /v1/domains/{id}` | — | 200 |

### Billing
`GET /v1/billing` → موجودی (تومان)، نوع حساب، آستانهٔ هشدار، فعال بودن هشدار، زمان آخرین هشدار. نام فیلدها → fixture در T0.5.

### Console (WebSocket)
`wss://api.liara.ir?token=<token>&cmd=/bin/bash&project_id=<id>` (+ `teamID`). معادل CLI: `liara shell -a <app> -c "<cmd>"`.
⚠️ توکن داخل URL است → URL هرگز لاگ نشود.

## ۳. فقط از طریق CLI
| نیاز | دستور |
|---|---|
| کاتالوگ پلن‌ها و قیمت‌ها | `liara plan:list` (فرمت خروجی در T0.5 ضبط شود) |
| خواندن envها | `liara env:list -a <app> --output json` |
| حذف env (اگر update-envs merge باشد) | `liara env:unset KEY -a <app> -f` |
| دیتابیس | `liara db create -n -t -v --plan --feature-plan -y`، `db list --output json`، `db resize`، `db start/stop`، `db remove -y` |
| deploy با لاگ build زنده | `liara deploy -a --path --port --platform -m --detach --no-app-logs -b iran\|germany` |
| لاگ زنده | `liara logs -a -f -t -s "1 hour ago" -r <version>` |
| اجرای دستور در کانتینر | `liara shell -a -c` |
| DNS لیارا | `liara zone create/check/get/list/delete` |

همهٔ دستورات با `--api-token` و در صورت نیاز `--team-id` اجرا می‌شوند.

## ۴. شکاف‌ها و راهبرد ما

| # | شکاف | راهبرد | تسک |
|---|---|---|---|
| G1 | جزئیات یک اپ | `GET /v1/projects` + فیلتر بر اساس `project_id` + cache کوتاه | T1.2 |
| G2 | خواندن env | CLI `env:list --output json` | T1.8 |
| G3 | معنای update-envs (جایگزینی یا merge) | spike؛ تا قبل از آن **همیشه: خواندن کل → merge → ارسال کل** | T0.8, T1.8 |
| G4 | لیست release / وضعیت / rollback | **دفتر deploy محلی** (`releaseID, sourceID, gitCommit, ...`). rollback = ساخت release جدید با `sourceID` قبلی؛ اگر لیارا سورس قدیمی را نگه نداشت → بیلد دوباره از git commit قبلی | T1.6, T6.5 |
| G5 | پیشرفت و نتیجهٔ build در deploy API | spike برای کشف سیگنال (events / logs / status / isDeployed). حالت پیش‌فرض deploy = CLI (لاگ build زنده)، حالت API هم پیاده و در دمو نشان داده شود | T0.8, T5.7 |
| G6 | کاتالوگ پلن | فقط CLI | T4.6 |
| G7 | اطلاعات اتصال دیتابیس | دریافت `dbaas.yaml` در T0.1؛ اگر نبود → مرحلهٔ انسانی (کپی از پنل با ورودی پنهان) | T1.13 |
| G8 | عملیات ناهمگام (restart/scale/delete فقط «ثبت شد» برمی‌گردانند) | helper `waitForState` با polling روی لیست + probe | T1.2 |
| G9 | واحد since در لاگ و متریک، واحد CPU/RAM | spike | T0.8 |
| G10 | rate limit | نامشخص؛ backoff روی 429 و ثبت مشاهدات | T1.1, T10.4 |
| G11 | آدرس پیش‌فرض اپ | احتمالاً `https://<name>.liara.run` → spike | T0.8 |
| G12 | کارهای فقط انسانی | شارژ حساب، خرید دامنه، تنظیم DNS نزد ثبت‌کننده | T5.4, T5.9, T10.4 |
