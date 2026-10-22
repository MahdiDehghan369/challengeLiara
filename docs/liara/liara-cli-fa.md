# Liara CLI و Billing — مستند رسمی فارسی (متن کامل)

> متن مستند رسمی لیارا که تیم فراهم کرده. خلاصهٔ انگلیسی و ساختاریافته در `liara-docs-06-cli.md` (CLI) و `liara-docs-05-billing.md` (billing) است.
> ⚠️ چند مثال در متن رسمی اشتباه کپی شده‌اند (مثلاً `liara restart -e email@example.com`، `liara db create` به جای `db start`، و `liara db remove` در بخش bucket delete). به بخش Quirks در `liara-docs-06-cli.md` نگاه کنید.

```text
دریافت اطلاعات مالی با API
برای دریافت اطلاعات مالی می‌توانید از endpoint زیر استفاده کنید:

https://api.liara.ir/v1/billing
این endpoint شامل اطلاعات زیر است:

میزان اعتبار (به تومان)
نوع اکانت (فرد حقیقی یا حقوقی)
اعتبار وقتی به کمتر از این عدد برسه، اطلاع‌رسانی ارسال می‌شه
فعال بودن یا نبودن هشدار حداقل اعتبار تنظیم شده توسط کاربر (در غیر این‌صورت، با تصمیم سیستم)
زمان آخرین باری که سیستم درباره کمبود اعتبار اطلاع‌رسانی کرده
نمونه ارسال درخواست

curl --request GET \
--url https://api.liara.ir/v1/billing \
--header "Authorization: Bearer TOKEN"
برای نصب cli، بایستی npm و NodeJS بر روی سیستم‌عامل‌تان نصب باشد که می‌توانید با مراجعه به [وب‌سایت رسمی NodeJS](https://nodejs.org/en/)، آخرین نسخه NodeJS TLS را متناسب با سیستم خود، دانلود و نصب کنید. پس از نصب NodeJS، ابزار npm نیز به صورت خودکار برای‌تان نصب می‌شود. اکنون. برای نصب Liara CLI، کافیست تا در ترمینال خود، دستور زیر را اجرا کنید:

npm install -g @liara/cli
برای ارتقاء Liara CLI نیز، بایستی همان دستور فوق را اجرا کنید. و درنهایت، با دستور زیر می‌توانید نسخه‌ی CLI جدید را چک کنید:

liara -v
رفع خطای عدم شناسایی Liara CLI
در صورتی که در اجرای دستورات Liara CLI به خطای command not found یا command is not recognized as an internal or external command برخوردید؛ کافیست تا به شکل زیر، به دستورات Liara CLI، عبارت npx را اضافه کنید:

npx liara login
npx liara deploy
یا:

npx @liara/cli login
npx @liara/cli deploy
ورود به حساب کاربری با Liara CLI
برای ورود به حساب کاربری لیارا، می‌توانید از دستور زیر، استفاده کنید:

liara login
پارامترهای دستور
دستور liara login، پارامترهای زیر را، می‌پذیرد:

liara login [-h] [--debug] [--api-token <value>]  [--account <value>] [-e <value>] [-p <value>] [-i] [--browser chrome|firefox|edge]
پارامتر    توضیحات    مثال
e- یا email--    برای درج ایمیل حساب کاربری ایجاد شده در لیارا    liara login -e email@example.com
h- یا help--    نمایش راهنما    liara login -h
p- یا password    برای درج رمز عبور حساب کاربری ایجاد شده در لیارا    **** liara login -e email@example.com -p
i- یا interactive    برای لاگین با استفاده از User و Password و نه مرورگر    liara login -i
account--    برای تغییر موقتی حساب کاربری    liara login --account alinajmabadi_iran
api-token--    
برای اجرای آنی عملیات login به کمک api token (مناسب ci/cd)

****=liara login --api-token
debug--    برای نمایش لاگ‌های دیباگ    liara disk:create --debug
browser--    برای انتخاب مرورگر برای لاگین    liara login --browser=firefox

تکمیل خودکار دستورات Liara CLI
برای تکمیل خودکار دستورات در ابزار Liara CLI، می‌توانید از دستور زیر، استفاده کنید:

liara autocomplete
مشاهده پلن‌های سرویس با Liara CLI
برای مشاهده پلن‌های سرویس، می‌توانید از دستور زیر، استفاده کنید:

liara plan:list
اضافه کردن حساب کاربری جدید با Liara CLI

برای اضافه کردن حساب کاربری جدید با Liara CLI، می‌توانید از دستور زیر، استفاده کنید:

liara account:add
پارامترهای دستور
دستور liara account:add، پارامترهای زیر را، می‌پذیرد:

liara account add [-h] [--debug] [--api-token <value>] [-a <value>] [-e <value>] [-p <value>] 
پارامتر    توضیحات    مثال
a- یا account--    انتخاب نام، برای اکانت    liara account:add -a mrfoo
e- یا email--    درج ایمیل برای اکانت جدید    liara account:add -e email@example.com
api-token--    
برای اجرای آنی اضافه کردن حساب کاربری به کمک api token (مناسب ci/cd)

****=liara account:add --api-token
debug--    برای نمایش دیباگ در کنار متغیرهای محیطی    liara account:add --debug
h- یا help--    نمایش راهنما    liara account:add -h
p- یا password    برای درج پسورد اکانت    **** liara account:add -p
همچنین برای استقرار در یک اکانت مشخص، شما می‌توانید در مسیر اصلی پروژه یک فایل به نام liara.json ایجاد کنید و محتوای آن را به شکل زیر بنویسید:

{
  "account": "account_name"
}
در کد فوق کافیست که به جای account_name نام حساب مدنظرتان را وارد کنید؛ پس از اجرای دستور liara deploy در صورت درست بودن نام حساب کاربری ، حساب به صورت خودکار تشخیص داده خواهد شد.

حذف یک حساب کاربری از Liara CLI
برای حذف یک حساب کاربری از Liara CLI، می‌توانید از دستور زیر، استفاده کنید:

liara account:remove
پارامترهای دستور
دستور liara account:remove یا liara account:rm، پارامترهای زیر را، می‌پذیرد:

liara account remove [-h] [--debug] [--api-token <value>]  [-a <value>] [--team-id <value>]
پارامتر    توضیحات    مثال
a- یا account--    انتخاب حساب هدف    liara account:remove -a oldfoo
api-token--    
برای اجرای آنی عملیات حذف اکانت به کمک api token (مناسب ci/cd)

****=liara account:remove --api-token
debug--    برای نمایش دیباگ در کنار حذف حساب کاربری    liara account:remove --debug
h- یا help--    نمایش راهنما    liara account:remove -h

انتخاب حساب پیش‌فرض در Liara CLI
برای انتخاب حساب پیش‌فرض در Liara CLI، می‌توانید از دستور زیر، استفاده کنید:

liara account:use
پارامترهای دستور
دستور liara account:use، پارامترهای زیر را، می‌پذیرد:

liara account use [-h] [--debug] [--api-token <value>]  [-a <value>] [--team-id <value>]
پارامتر    توضیحات    مثال
a- یا account--    انتخاب حساب هدف    liara account:use -a oldfoo
api-token--    
برای اجرای آنی عملیات انتخاب اکانت به کمک api token (مناسب ci/cd)

****=liara account:use --api-token
debug--    برای نمایش دیباگ در کنار حذف حساب کاربری    liara account:use --debug
h- یا help--    نمایش راهنما    liara account:use -h

ایجاد فایل liara.json با Liara CLI
برای ایجاد فایل liara.json با Liara CLI، می‌توانید از دستور زیر، استفاده کنید (دستور را در مسیر اصلی پروژه‌تان اجرا کنید تا فایل liara.json در مسیر اصلی پروژه‌تان ایجاد شود):

liara init
پارامترهای دستور
دستور liara init، پارامترهای زیر را، می‌پذیرد:

$ liara init [-h] [--debug] [--api-token <value>] [--account <value>] [-y] [-n <value>] [-p <value>] [-P <value>]
[-v <value>] [--build-location <value>] [-d <value> --path <value>] [--team-id <value>]
پارامتر    توضیحات    مثال
h- یا help--    نمایش راهنما    liara init -h
debug--    برای نمایش لاگ‌های دیباگ    liara init --debug
team-id--    
انتخاب تیم با استفاده از شناسه آن

liara init --team-id=your-team-id
api-token--    
برای اجرای آنی عملیات ساخت فایل liara.json به کمک api token (مناسب ci/cd)

****=liara init --api-token
account--    برای تغییر موقتی حساب کاربری    liara init --account alinajmabadi_iran
y- یا yes--    
برای ساخت یک قالب liara.json پیش‌فرض

liara init -y
n- یا name--    
انتخاب شناسه برنامه

liara init -n mynode-app
p- یا port--    
انتخاب پورت برنامه که در آن به درخواست کاربران گوش می‌دهد

liara init -p 3005
P- یا platform--    برای انتخاب پلتفرم برنامه    liara init -P next
v- یا version--    
انتخاب ورژن پلتفرم

liara init -v 22
build-location--    
برای انتخاب موقعیت build برنامه

liara init --build-location=germany
d- یا disk--    
انتخاب نام و مسیر دیسک

liara init -d data --path /path/to/data

ایجاد برنامه با Liara CLI
برای ایجاد برنامه با Liara CLI، می‌توانید از دستور زیر، استفاده کنید:

liara create # or liara app:create
پارامترهای دستور
دستور liara create یا liara app:create، پارامترهای زیر را، می‌پذیرد:

liara create [-h] [--debug] [--api-token <value>]  [--account <value>] [-a
  <value>] [--platform <value>] [--plan <value>] [--feature-plan <value>] [-n <value>] [-r true|false] [--team-id <value>]
پارامتر    توضیحات    مثال
a- یا app--    برای درج شناسه برنامه‌ای که قصد ایجاد آن را دارید    liara create --app=my-web-app
h- یا help--    نمایش راهنما    liara create -h
n- یا network--    
انتخاب شبکه خصوصی برنامه

liara create -n liara-net
r- یا read-only--    
انتخاب readOnly بودن یا Writable بودن فایل‌سیستم

liara create -r true
account--    برای تغییر موقتی حساب کاربری    liara create --account alinajmabadi_iran
team-id--    
انتخاب تیم با استفاده از شناسه آن

liara create --team-id=your-team-id
api-token--    
برای اجرای آنی عملیات ساخت برنامه به کمک api token (مناسب ci/cd)

****=liara create --api-token
debug--    برای نمایش لاگ‌های دیباگ    liara create --debug
feature-plan--    برای انتخاب بسته امکانات برنامه    "liara create --feature-plan=free
plan--    
برای انتخاب پلن برنامه

liara create --plan=free
platform--    برای مشخص کردن پلتفرم برنامه‌ای که قصد استقرار آن را دارید    liara create --platform=docker

حذف برنامه با Liara CLI
برای حذف برنامه با Liara CLI، می‌توانید از دستور زیر، استفاده کنید:

liara delete
پارامترهای دستور
دستور liara delete، liara app:delete، liara app remove یا liara app rm پارامترهای زیر را، می‌پذیرد:

 liara delete [-h] [--debug] [--api-token <value>]  [--account <value>] [-a <value>] [--team-id <value>]
پارامتر    توضیحات    مثال
a- یا app--    برای درج شناسه برنامه‌ای که قصد حذف آن را دارید    liara delete --app=my-web-app
h- یا help--    نمایش راهنما    liara delete -h
account--    برای تغییر موقتی حساب کاربری    liara delete --account alinajmabadi_iran
team-id--    
انتخاب تیم با استفاده از شناسه آن

liara delete --team-id=your-team-id
api-token--    
برای اجرای آنی عملیات delete به کمک api token (مناسب ci/cd)

****=liara delete --api-token
debug--    برای نمایش لاگ‌های دیباگ    liara delete --debug

مشاهده لیستی از برنامه‌های ایجاد شده با Liara CLI
برای مشاهده لیستی از برنامه‌های ایجاد شده با Liara CLI، می‌توانید از دستور زیر، استفاده کنید:

liara app:list
پارامترهای دستور
دستور liara app:listیا liara app:ls، پارامترهای زیر را، می‌پذیرد:

 liara app ls [-h] [--debug] [--api-token <value>]  [--account <value>] [--columns
  <value> | -x] [--filter <value>] [--no-header | [--csv | --no-truncate]] [--output csv|json|yaml] [--sort
  <value>] [--team-id <value>]
پارامتر    توضیحات    مثال
x- یا extended--    نمایش اطلاعات و ستون‌های اضافی برنامه‌ها    liara app:ls --extended
h- یا help--    نمایش راهنما    liara app:ls -h
account--    برای تغییر موقتی حساب کاربری    liara app:ls --account alinajmabadi_iran
team-id--    
انتخاب تیم با استفاده از شناسه آن

liara app:ls --team-id=your-team-id
api-token--    
برای اجرای آنی عملیات نمایش برنامه‌ها به کمک api token (مناسب ci/cd)

****=liara app:ls --api-token
debug--    برای نمایش لاگ‌های دیباگ    liara app:ls --debug
columns--    برای نمایش فقط ستون‌های انتخاب شده    liara app:ls --columns=Status,Name
csv-- یا output=csv--    
برای نمایش خروجی در فرمت CSV

liara app:ls --csv
filter--    
برای فیلتر یک ستون با اسم

"liara app:ls --filter="name=myapp
no-header--    برای عدم نمایش هدرهای جدول    liara app:ls --no-header
no-truncate--    برای جلوگیری از کوتاه شدن یا برش خروجی به اندازه‌ی صفحه نمایش    liara app:ls --no-truncate
output--    
برای تعیین فرمت خروجی (CSV , YAML , JSON)

liara app:ls --output=json
sort--    
برای مرتب‌سازی بر اساس یک ستون (مرتب‌سازی descending با -)

liara app:ls --sort=-Name

مشاهده لاگ‌های برنامه با Liara CLI
برای مشاهده لاگ‌های برنامه با Liara CLI، می‌توانید از دستور زیر، استفاده کنید:

liara logs
پارامترهای دستور
دستور liara app:logsیا liara logs، پارامترهای زیر را، می‌پذیرد:

liara logs [-h] [--debug] [--api-token <value>]  [--account <value>] [-a <value>]
         [-s <value>] [-t] [-f] [-c] [--team-id <value>] [-r <version>] [--release <version>]
پارامتر    توضیحات    مثال
a- یا app--    انتخاب برنامه موردنظر    liara logs -a my-web-app
c- یا colorize--    نمایش لاگ‌ها با رنگ‌بندی    liara logs -c
account--    برای تغییر موقتی حساب کاربری    liara logs --account alinajmabadi_iran
team-id--    
انتخاب تیم با استفاده از شناسه آن

liara logs --team-id=your-team-id
api-token--    
برای اجرای آنی عملیات نمایش لاگ‌های برنامه به کمک api token (مناسب ci/cd)

****=liara logs --api-token
debug--    برای نمایش لاگ‌ها به همراه دیباگ    liara logs --debug
h- یا help--    نمایش راهنما    liara logs -h
f- یا follow--    
برای دنبال کردن لحظه‌ای (real-time) لاگ‌ها

liara logs --follow
t- یا timestamps--    
نمایش timestampها

liara logs --timestamps
s- یا since--    
نمایش لاگ‌ها بر اساس timestamp وارد شده

"liara logs --since="1 hour ago
r- یا release--    
نمایش لاگ‌ها بر اساس ورژن استقرار برنامه

liara logs -r v2

ری‌استارت برنامه با Liara CLI
برای ری‌استارت برنامه در لیارا، می‌توانید از دستور زیر، استفاده کنید:

liara restart
پارامترهای دستور
دستور liara restart یا liara app:restart، پارامترهای زیر را، می‌پذیرد:

 liara restart [-h] [--debug] [--api-token <value>]  [--account <value>] [-a <value>] [--team-id <value>] [--team-id <value>]
پارامتر    توضیحات    مثال
a- یا app--    برای درج شناسه برنامه موردنظر    liara restart -e email@example.com
h- یا help--    نمایش راهنما    liara restart -h
account--    برای تغییر موقتی حساب کاربری    liara restart --account alinajmabadi_iran
team-id--    
انتخاب تیم با استفاده از شناسه آن

liara restart --team-id=your-team-id
api-token--    
برای اجرای آنی عملیات restart به کمک api token (مناسب ci/cd)

****=liara restart --api-token
debug--    برای نمایش لاگ‌های دیباگ    liara disk:create --debug

اتصال به خط فرمان برنامه با Liara CLI
برای اتصال به خط فرمان برنامه با Liara CLI، می‌توانید از دستور زیر، استفاده کنید:

liara shell
پارامترهای دستور
دستور liara app:shellیا liara shell، پارامترهای زیر را، می‌پذیرد:

liara shell [-h] [--debug] [--api-token <value>]  [--account <value>] [-a <value>] [-c <value>] [--team-id <value>]
پارامتر    توضیحات    مثال
a- یا app--    انتخاب برنامه موردنظر    liara shell -a my-web-app
c- یا command--    انتخاب دستور برای اجرا    liara shell --command=/bin/sh
account--    برای تغییر موقتی حساب کاربری    liara shell --account alinajmabadi_iran
team-id--    
انتخاب تیم با استفاده از شناسه آن

liara shell --team-id=your-team-id
api-token--    
برای اجرای آنی عملیات اتصال به خط فرمان برنامه به کمک api token (مناسب ci/cd)

****=liara shell --api-token
debug--    برای نمایش لاگ‌ها به همراه دیباگ    liara shell --debug
h- یا help--    نمایش راهنما    liara shell -h

مدیریت دیسک‌ها در Liara CLI
برای مدیریت دیسک‌های برنامه‌های خود در لیارا، می‌توانید می‌توانید با اجرای دستور زیر، دستورات مرتبط را مشاهده کنید:

liara disk
برای ایجاد یک دیسک جدید، می‌توانید دستور زیر را اجرا کنید:

liara disk:create
این دستور از شما شناسه برنامه، نام و اندازه دیسک مورد نیاز را می‌پرسد.

پارامترهای دستور
دستور liara disk:create، پارامترهای زیر را، می‌پذیرد:

liara disk create [-h] [--debug] [--api-token <value>]  [--account <value>] [-a <value>] [-n <value>] [-s <value>] [--team-id <value>]
پارامتر    توضیحات    مثال
a- یا app--    برای درج شناسه برنامه موردنظرتان که قصد دارید در آن دیسک ایجاد کنید    liara disk:create -a myapp
h- یا help--    نمایش راهنما    liara disk:create -h
n- یا name--    برای درج نام دیسکی که قصد دارید ایجاد کنید    liara disk:create -n data
s- یا size--    برای درج اندازه دیسکی که قصد دارید ایجاد کنید (به گیگابایت)    liara disk:create -s 2
account--    برای تغییر موقتی حساب کاربری در جهت ایجاد دیسک    liara disk:create --account alinajmabadi_iran
team-id--    
انتخاب تیم با استفاده از شناسه آن

liara disk:create --team-id=your-team-id
api-token--    
برای اجرای آنی عملیات ایجاد دیسک به کمک api token بدون ورود به حساب کاربری (مناسب ci/cd)

****=liara disk:create --api-token
debug--    برای نمایش لاگ‌های دیباگ    liara disk:create --debug

استقرار برنامه با Liara CLI
برای استقرار برنامه با Liara CLI، می‌توانید از دستور زیر، استفاده کنید:

liara deploy
پارامترهای دستور
دستور liara deploy، پارامترهای زیر را، می‌پذیرد:

liara deploy [-h] [--debug] [--api-token <value>]  [--account <value>] [--path
  <value>] [--platform <value>] [-a <value>] [-p <value>] [-i <value>] [--detach] [--no-app-logs] [--args <value>]
  [--build-arg <value>...] [-m <value>] [-d <value>...] [--no-cache] [-f <value>] [-b iran|germany] [--team-id <value>]
  [--liara-json <value>]
پارامتر    توضیحات    مثال
a- یا app--    برای درج شناسه برنامه‌ای که قصد دارید پروژه‌تان در آن مستقر شود    liara deploy --app=my-web-app
h- یا help--    نمایش راهنما    liara deploy -h
d- یا disks--    برای تصال یک یا چند دیسک به مسیرهای مورد نظر    liara deploy -d data=/var/www/html
i- یا image--    
برای استقرار مستقیم Image از DockerHub

liara deploy -i nextcloud:1.23
account--    برای تغییر موقتی حساب کاربری    liara deploy --account alinajmabadi_iran
team-id--    
انتخاب تیم با استفاده از شناسه آن

liara deploy --team-id=your-team-id
api-token--    
برای اجرای آنی عملیات استقرار به کمک api token (مناسب ci/cd)

****=liara deploy --api-token
debug--    برای نمایش لاگ‌های دیباگ    liara deploy --debug
m- یا message    برای در نظر گرفتن پیامی برای استقرار    "liara deploy --message="fix the user login bug
p- یا port--    
برای درج پورتی که برنامه‌ی شما بر روی آن Listen می‌کند

liara deploy --port=3000
path--    برای درج آدرس ریشه پروژه‌ای که قصد استقرار آن را دارید    liara deploy --path=/path/to/project
detach--    برای عدم نمایش لاگ‌ها بعد از هر استقرار    liara deploy --detach
platform--    برای مشخص کردن پلتفرم برنامه‌ای که قصد استقرار آن را دارید    liara deploy --platfor=docker
b- یا build-location--    
برای انتخاب موقعیت build برنامه

liara deploy --build-location=germany
f- یا dockerfile    
برای انتخاب نام Dockerfile در صورتی که با نام دیگری ذخیره شده است

"liara deploy --dockerfile="path/to/myDocker
args--    
برای واردکردن entrypoint argهای یک Docker Image

"liara deploy --args="sh -c sleep 10 && /entrypoint.sh run
build-arg--    
برای واردکردن build argهای یک Docker Image

"liara deploy --build-arg="APP_VERSION=2.0.0
no-app-logs--    عدم نمایش لاگ‌های برنامه پس از استقرار    liara deploy --no-app-logs
no-cache--    عدم استفاده از کش ورژن قبلی در هنگام استقرار برنامه    liara deploy --no-cache
liara-json--    
تعیین فایل JSON جایگزین فایل liara.json

liara deploy --liara-json=myapp.json

روشن کردن برنامه خاموش با Liara CLI
برای روشن کردن برنامه خاموش با Liara CLI، می‌توانید از دستور زیر، استفاده کنید:

liara start
پارامترهای دستور
دستور liara app:startیا liara start، پارامترهای زیر را، می‌پذیرد:

liara start [-h] [--debug] [--api-token <value>]  [--account <value>] [-a <value>] [--team-id <value>]
پارامتر    توضیحات    مثال
a- یا app--    انتخاب برنامه موردنظر    liara start -a my-web-app
account--    برای تغییر موقتی حساب کاربری    liara start --account alinajmabadi_iran
team-id--    
انتخاب تیم با استفاده از شناسه آن

liara start --team-id=your-team-id
api-token--    
برای اجرای آنی عملیات روشن کردن برنامه خاموش به کمک api token (مناسب ci/cd)

****=liara start --api-token
debug--    برای نمایش لاگ‌ها به همراه دیباگ    liara start --debug
h- یا help--    نمایش راهنما    liara start -h

خاموش کردن برنامه با Liara CLI
برای خاموش کردن برنامه با Liara CLI، می‌توانید از دستور زیر، استفاده کنید:

liara stop
پارامترهای دستور
دستور liara app:stopیا liara stop، پارامترهای زیر را، می‌پذیرد:

liara stop [-h] [--debug] [--api-token <value>]  [--account <value>] [-a <value>] [--team-id <value>] [--team-id <value>]
پارامتر    توضیحات    مثال
a- یا app--    انتخاب برنامه موردنظر    liara stop -a my-web-app
account--    برای تغییر موقتی حساب کاربری    liara stop --account alinajmabadi_iran
team-id--    
انتخاب تیم با استفاده از شناسه آن

liara stop --team-id=your-team-id
api-token--    
برای اجرای آنی عملیات خاموش کردن برنامه به کمک api token (مناسب ci/cd)

****=liara stop --api-token
debug--    برای نمایش لاگ‌ها به همراه دیباگ    liara stop --debug
h- یا help--    نمایش راهنما    liara stop -h

لیست متغیرهای محیطی برنامه با Liara CLI
برای لیست متغیرهای محیطی برنامه با Liara CLI، می‌توانید از دستور زیر، استفاده کنید:

liara env:list
پارامترهای دستور
دستور liara env:listیا liara env:ls، پارامترهای زیر را، می‌پذیرد:

liara env list [-h] [--debug] [--api-token <value>]  [--account <value>] [-a
  <value>] [--columns <value> | -x] [--filter <value>] [--no-header | [--csv | --no-truncate]] [--output csv|json|yaml
  |  | ] [--sort <value>] [--team-id <value>]
پارامتر    توضیحات    مثال
x- یا extended--    نمایش اطلاعات اضافی متغیرها    liara env:ls --extended
account--    برای تغییر موقتی حساب کاربری    liara env:ls --account alinajmabadi_iran
team-id--    
انتخاب تیم با استفاده از شناسه آن

liara env:ls --team-id=your-team-id
api-token--    
برای اجرای آنی عملیات نمایش متغیرها به کمک api token (مناسب ci/cd)

****=liara env:ls --api-token
debug--    برای نمایش دیباگ در کنار متغیرهای محیطی    liara env:ls --debug
columns--    برای نمایش فقط ستون‌های انتخاب شده    liara env:ls --columns=Key
csv-- یا output=csv--    
برای نمایش خروجی در فرمت CSV

liara env:ls --csv
filter--    
برای فیلتر یک ستون با اسم

"liara env:ls --filter="Key=auth
no-header--    برای عدم نمایش هدرهای جدول    liara env:ls --no-header
no-truncate--    برای جلوگیری از کوتاه شدن یا برش خروجی به اندازه‌ی صفحه نمایش    liara env:ls --no-truncate
output--    
برای تعیین فرمت خروجی (CSV , YAML , JSON)

liara env:ls --output=json
sort--    
برای مرتب‌سازی بر اساس یک ستون (مرتب‌سازی descending با -)

liara env:ls --sort=-Value
h- یا help--    نمایش راهنما    liara env:ls -h
a- یا app--    انتخاب برنامه هدف    liara env:ls -a my-web-app

ثبت یا ویرایش متغیرهای محیطی با Liara CLI
برای ثبت یا ویرایش متغیرهای محیطی با Liara CLI، می‌توانید از دستور زیر، استفاده کنید:

liara env:set
پارامترهای دستور
دستور liara env:set، پارامترهای زیر را، می‌پذیرد:

liara env set [ENV...] [-h] [--debug] [--api-token <value>]  [--account <value>]
  [-a <value>] [-f] [--team-id <value>]
پارامتر    توضیحات    مثال
a- یا app--    انتخاب برنامه هدف    liara env:set -a my-web-app
f- یا force--    تنظیم و یا ویرایش متغیرهای محیطی یک برنامه بدون نیاز به تایید    liara env:set -f
account--    برای تغییر موقتی حساب کاربری    liara env:set --account alinajmabadi_iran
team-id--    
انتخاب تیم با استفاده از شناسه آن

liara env:set --team-id=your-team-id
api-token--    
برای اجرای آنی عملیات تنظیم یا ویرایش متغیرها به کمک api token (مناسب ci/cd)

****=liara env:set --api-token
debug--    برای نمایش دیباگ در کنار متغیرهای محیطی    liara env:set --debug
h- یا help--    نمایش راهنما    liara env:set -h

حذف متغیرهای محیطی با Liara CLI
برای حذف متغیرهای محیطی با Liara CLI، می‌توانید از دستور زیر، استفاده کنید:

liara env:unset
پارامترهای دستور
دستور liara env:unset، پارامترهای زیر را، می‌پذیرد:

liara env unset [ENV...] [-h] [--debug] [--api-token <value>]  [--account <value>] [-a <value>] [-f] [--team-id <value>]
پارامتر    توضیحات    مثال
a- یا app--    انتخاب برنامه هدف    liara env:unset -a my-web-app
f- یا force--    حذف متغیرهای محیطی یک برنامه بدون نیاز به تایید    liara env:set -f
account--    برای تغییر موقتی حساب کاربری    liara env:unset --account alinajmabadi_iran
team-id--    
انتخاب تیم با استفاده از شناسه آن

liara env:unset --team-id=your-team-id
api-token--    
برای اجرای آنی عملیات حذف متغیرها به کمک api token (مناسب ci/cd)

****=liara env:unset --api-token
debug--    برای نمایش دیباگ در کنار متغیرهای محیطی    liara env:unset --debug
h- یا help--    نمایش راهنما    liara env:unset -h

ایجاد دیتابیس با Liara CLI
برای ایجاد دیتابیس با Liara CLI، می‌توانید از دستور زیر، استفاده کنید:

liara db create
پارامترهای دستور
دستور liara db create، پارامترهای زیر را، می‌پذیرد:

liara db create [-h] [--debug] [--api-token <value>] [--account <value>] [-n
  <value>] [--plan <value>] [--public-network] [--feature-plan <value>] [-t <value>] [-v <value>]
  [-y] [--network <value>] [--team-id <value>]
پارامتر    توضیحات    مثال
h- یا help--    نمایش راهنما    liara db create -h
debug--    برای نمایش لاگ‌های دیباگ    liara db create --debug
team-id--    
انتخاب تیم با استفاده از شناسه آن

liara db create --team-id=your-team-id
api-token--    
برای اجرای آنی عملیات ساخت دیتابیس به کمک api token (مناسب ci/cd)

****=liara db create --api-token
account--    برای تغییر موقتی حساب کاربری    liara db create --account john_doe
n- یا name--    برای درج نام دیتابیسی که قصد ایجاد آن را دارید    liara db create -n my-db
plan--    
برای انتخاب پلن دیتابیس

liara db create --plan=medium-g2
public-network--    برای فعال‌سازی شبکه عمومی دیتابیس    liara db create --public-network
feature-plan--    برای انتخاب بسته امکانات دیتابیس    liara db create --feature-plan=free
t- یا type--    برای انتخاب نوع دیتابیس    liara db create -t mysql
v- یا version--    برای انتخاب ورژن دیتابیس انتخابی    liara db create -v 10.6.8
y- یا yes--    تایید برای ادامه عملیات و ساخت دیتابیس    liara db create -y
network--    
انتخاب شبکه خصوصی دیتابیس

liara db create --network=liara-net

حذف دیتابیس با Liara CLI
برای حذف دیتابیس با Liara CLI، می‌توانید از دستور زیر، استفاده کنید:

liara db remove # or liara db rm
پارامترهای دستور
دستور liara db remove، liara db rm پارامترهای زیر را، می‌پذیرد:

 liara db remove [-h] [--debug] [--api-token <value>] [--account <value>] [-n <value>] [-y] [--team-id <value>]
پارامتر    توضیحات    مثال
h- یا help--    نمایش راهنما    liara db rm -h
debug--    برای نمایش لاگ‌های دیباگ    liara db rm --debug
team-id--    
انتخاب تیم با استفاده از شناسه آن

liara db rm --team-id=your-team-id
api-token--    
برای اجرای آنی عملیات delete به کمک api token (مناسب ci/cd)

****=liara db rm --api-token
account--    برای تغییر موقتی حساب کاربری    liara db rm --account jane_doe
n- یا name--    برای درج نام دیتابیسی که قصد حذف آن را دارید    liara db rm -n my-db
y- یا yes--    برای تایید حذف دیتابیس    liara db rm -y

مشاهده لیستی از دیتابیس‌های ایجاد شده با Liara CLI
برای مشاهده لیستی از دیتابیس‌های ایجاد شده با Liara CLI، می‌توانید از دستور زیر، استفاده کنید:

liara db list # or liara db ls
پارامترهای دستور
دستور liara db listیا liara db ls، پارامترهای زیر را، می‌پذیرد:

 liara db ls [-h] [--debug] [--api-token <value>]  [--account <value>] [--columns
  <value> | -x] [--filter <value>] [--no-header | [--csv | --no-truncate]] [--output csv|json|yaml] [--sort
  <value>] [--team-id <value>]
پارامتر    توضیحات    مثال
x- یا extended--    نمایش اطلاعات و ستون‌های اضافی دیتابیس‌ها    liara db ls --extended
h- یا help--    نمایش راهنما    liara db ls -h
account--    برای تغییر موقتی حساب کاربری    liara db ls --account alinajmabadi_iran
team-id--    
انتخاب تیم با استفاده از شناسه آن

liara db ls --team-id=your-team-id
api-token--    
برای اجرای آنی عملیات نمایش دیتابیس‌ها به کمک api token (مناسب ci/cd)

****=liara db ls --api-token
debug--    برای نمایش لاگ‌های دیباگ    liara db ls --debug
columns--    برای نمایش فقط ستون‌های انتخاب شده    liara db ls --columns=Status,Name
csv-- یا output=csv--    
برای نمایش خروجی در فرمت CSV

liara db ls --csv
filter--    
برای فیلتر یک ستون با اسم

"liara db ls --filter="name=myapp
no-header--    برای عدم نمایش هدرهای جدول    liara db ls --no-header
no-truncate--    برای جلوگیری از کوتاه شدن یا برش خروجی به اندازه‌ی صفحه نمایش    liara db ls --no-truncate
output--    
برای تعیین فرمت خروجی (CSV , YAML , JSON)

liara db ls --output=json
sort--    
برای مرتب‌سازی بر اساس یک ستون (مرتب‌سازی descending با -)

liara db ls --sort=-Name

تغییر اندازه منابع سخت‌افزاری با Liara CLI
برای تغییر اندازه منابع سخت‌افزاری با Liara CLI، می‌توانید از دستور زیر، استفاده کنید:

liara db resize
پارامترهای دستور
دستور liara db resize، پارامترهای زیر را، می‌پذیرد:

liara db resize [-h] [--debug] [--api-token <value>] [--account <value>] 
[-n <value>] [--plan <value>] [-d <value>] [--team-id <value>]
پارامتر    توضیحات    مثال
h- یا help--    نمایش راهنما    liara db resize -h
debug--    برای نمایش لاگ‌های دیباگ    liara db resize --debug
team-id--    
انتخاب تیم با استفاده از شناسه آن

liara db resize --team-id=your-team-id
api-token--    
برای اجرای آنی عملیات تغییر اندازه دیتابیس به کمک api token (مناسب ci/cd)

****=liara db resize --api-token
account--    برای تغییر موقتی حساب کاربری    liara db resize --account john_doe
n- یا name--    برای درج نام دیتابیسی که قصد ایجاد آن را دارید    liara db resize -n my-db
plan--    
برای انتخاب پلن جدید دیتابیس

liara db resize --plan=medium-g2
d- یا disk--    برای تایید افزایش فضای دیسک دیتابیس    liara db resize -d y

روشن‌کردن دیتابیس با Liara CLI
برای روشن‌کردن دیتابیس با Liara CLI، می‌توانید از دستور زیر، استفاده کنید:

liara db start
پارامترهای دستور
دستور liara db create، پارامترهای زیر را، می‌پذیرد:

liara db start [-h] [--debug] [--api-token <value>] 
[--account <value>] [-n <value>] [--team-id <value>]
پارامتر    توضیحات    مثال
h- یا help--    نمایش راهنما    liara db create -h
debug--    برای نمایش لاگ‌های دیباگ    liara db create --debug
team-id--    
انتخاب تیم با استفاده از شناسه آن

liara db create --team-id=your-team-id
api-token--    
برای اجرای آنی عملیات روشن‌کردن دیتابیس به کمک api token (مناسب ci/cd)

****=liara db create --api-token
account--    برای تغییر موقتی حساب کاربری    liara db create --account john_doe
n- یا name--    برای درج نام دیتابیسی که قصد روشن‌کردن آن را دارید    liara db create -n my-db

خاموش‌کردن دیتابیس با Liara CLI
برای خاموش‌کردن دیتابیس با Liara CLI، می‌توانید از دستور زیر، استفاده کنید:

liara db stop
پارامترهای دستور
دستور liara db stop، پارامترهای زیر را، می‌پذیرد:

liara db stop [-h] [--debug] [--api-token <value>] 
[--account <value>] [-n <value>] [--team-id <value>]
پارامتر    توضیحات    مثال
h- یا help--    نمایش راهنما    liara db stop -h
debug--    برای نمایش لاگ‌های دیباگ    liara db stop --debug
team-id--    
انتخاب تیم با استفاده از شناسه آن

liara db stop --team-id=your-team-id
api-token--    
برای اجرای آنی عملیات خاموش‌کردن دیتابیس به کمک api token (مناسب ci/cd)

****=liara db stop --api-token
account--    برای تغییر موقتی حساب کاربری    liara db stop --account john_doe
n- یا name--    برای درج نام دیتابیسی که قصد خاموش‌کردن آن را دارید    liara db stop -n my-db

ایجاد باکت با Liara CLI
برای ایجاد باکت با Liara CLI، می‌توانید از دستور زیر، استفاده کنید:

liara bucket create
پارامترهای دستور
دستور liara bucket create، پارامترهای زیر را، می‌پذیرد:

liara bucket create [-h] [--debug] [--api-token <value>] [--account <value>] [--name <value>] 
[--permission <value>] [--plan <value>] [--team-id <value>]
پارامتر    توضیحات    مثال
h- یا help--    نمایش راهنما    liara bucket create -h
debug--    برای نمایش لاگ‌های دیباگ    liara bucket create --debug
team-id--    
انتخاب تیم با استفاده از شناسه آن

liara bucket create --team-id=your-team-id
api-token--    
برای اجرای آنی عملیات ساخت باکت به کمک api token (مناسب ci/cd)

****=liara bucket create --api-token
account--    برای تغییر موقتی حساب کاربری    liara bucket create --account john_doe
name--    برای درج نام باکتی که قصد ایجاد آن را دارید    liara bucket create --name=my-bucket
permission--    
برای تعیین نوع دسترسی به باکت

liara bucket create --permission=private
plan--    
برای انتخاب پلن باکت

liara bucket create --plan=medium-g2

حذف باکت با Liara CLI
برای حذف باکت با Liara CLI، می‌توانید از دستور زیر، استفاده کنید:

liara bucket delete
پارامترهای دستور
دستور liara db remove، liara bucket delete پارامترهای زیر را، می‌پذیرد:

 liara db remove [-h] [--debug] [--api-token <value>] [--account <value>] [-b <value>] [-f] [--team-id <value>]
پارامتر    توضیحات    مثال
h- یا help--    نمایش راهنما    liara bucket delete -h
debug--    برای نمایش لاگ‌های دیباگ    liara bucket delete --debug
team-id--    
انتخاب تیم با استفاده از شناسه آن

liara bucket delete --team-id=your-team-id
api-token--    
برای اجرای آنی عملیات delete به کمک api token (مناسب ci/cd)

****=liara bucket delete --api-token
account--    برای تغییر موقتی حساب کاربری    liara bucket delete --account jane_doe
b- یا bucket--    برای درج نام باکتی که قصد حذف آن را دارید    liara bucket delete -b my-bucket
f- یا force--    برای حذف باکت با اعمال اجبار    liara bucket delete -f

مشاهده لیستی از باکت‌های ایجاد شده با Liara CLI
برای مشاهده لیستی از باکت‌های ایجاد شده با Liara CLI، می‌توانید از دستور زیر، استفاده کنید:

liara bucket ls # or liara bucket list
پارامترهای دستور
دستور liara bucket lsیا liara bucket list، پارامترهای زیر را، می‌پذیرد:

 liara bucket ls [-h] [--debug] [--api-token <value>]  [--account <value>] [--columns
  <value> | -x] [--filter <value>] [--no-header | [--csv | --no-truncate]] [--output csv|json|yaml] [--sort
  <value>] [--team-id <value>]
پارامتر    توضیحات    مثال
x- یا extended--    نمایش اطلاعات و ستون‌های اضافی باکت‌ها    liara bucket ls --extended
h- یا help--    نمایش راهنما    liara bucket ls -h
account--    برای تغییر موقتی حساب کاربری    liara bucket ls --account alinajmabadi_iran
team-id--    
انتخاب تیم با استفاده از شناسه آن

liara bucket ls --team-id=your-team-id
api-token--    
برای اجرای آنی عملیات نمایش باکت‌ها به کمک api token (مناسب ci/cd)

****=liara bucket ls --api-token
debug--    برای نمایش لاگ‌های دیباگ    liara bucket ls --debug
columns--    برای نمایش فقط ستون‌های انتخاب شده    liara bucket ls --columns=Status,Name
csv-- یا output=csv--    
برای نمایش خروجی در فرمت CSV

liara bucket ls --csv
filter--    
برای فیلتر یک ستون با اسم

"liara bucket ls --filter="name=myapp
no-header--    برای عدم نمایش هدرهای جدول    liara bucket ls --no-header
no-truncate--    برای جلوگیری از کوتاه شدن یا برش خروجی به اندازه‌ی صفحه نمایش    liara bucket ls --no-truncate
output--    
برای تعیین فرمت خروجی (CSV , YAML , JSON)

liara bucket ls --output=json
sort--    
برای مرتب‌سازی بر اساس یک ستون (مرتب‌سازی descending با -)

liara bucket ls --sort=-Name

ایجاد سامانه مدیریت دامنه با Liara CLI
برای ایجاد سامانه مدیریت برای دامنه مدنظرتان با Liara CLI، می‌توانید از دستور زیر، استفاده کنید:

liara zone create
پارامترهای دستور
دستور liara zone create، پارامترهای زیر را، می‌پذیرد:

liara zone create [-h] [--debug] [--api-token <value>] [--account <value>] [-z
  <value>] [--team-id <value>]
پارامتر    توضیحات    مثال
h- یا help--    نمایش راهنما    liara zone create -h
debug--    برای نمایش لاگ‌های دیباگ    liara zone create --debug
team-id--    
انتخاب تیم با استفاده از شناسه آن

liara zone create --team-id=your-team-id
api-token--    
برای اجرای آنی عملیات ساخت سامانه مدیریت دامنه به کمک api token (مناسب ci/cd)

****=liara zone create --api-token
account--    برای تغییر موقتی حساب کاربری    liara zone create --account john_doe
z- یا zone--    برای درج آدرس دامنه‌ای که قصد ایجاد سامانه مدیریت آن را دارید    liara zone create -z looms.ir

حذف دامنه از DNS لیارا با Liara CLI
برای حذف دامنه از DNS لیارا با Liara CLI، می‌توانید از دستور زیر، استفاده کنید:

liara zone del # or liara zone delete
پارامترهای دستور
دستور liara zone del، liara zone delete یا liara zone rm پارامترهای زیر را، می‌پذیرد:

 liara zone rm [-h] [--debug] [--api-token <value>] [--account <value>] [-z <value>] [-y] [--team-id <value>]
پارامتر    توضیحات    مثال
h- یا help--    نمایش راهنما    liara zone rm -h
debug--    برای نمایش لاگ‌های دیباگ    liara zone rm --debug
team-id--    
انتخاب تیم با استفاده از شناسه آن

liara zone rm --team-id=your-team-id
api-token--    
برای اجرای آنی عملیات delete به کمک api token (مناسب ci/cd)

****=liara zone rm --api-token
account--    برای تغییر موقتی حساب کاربری    liara zone rm --account jane_doe
z- یا zone--    برای درج آدرس دامنه‌ای که قصد حذف آن را دارید    liara zone rm -n looms.ir
y- یا yes--    برای تایید حذف دامنه از DNS لیارا    liara zone rm -y

بررسی وضعیت دامنه با Liara CLI
برای بررسی وضعیت یک دامنه و اطمینان از اینکه NSهای لیارا، به درستی در سرویسی که دامنه را از آن تهیه کرده‌اید؛ تنظیم شده‌اند یا خیر، با Liara CLI، می‌توانید از دستور زیر، استفاده کنید:

liara zone ch # or liara zone check
پارامترهای دستور
دستور liara zone check یا liara zone ch، پارامترهای زیر را، می‌پذیرد:

liara zone ch [-h] [--debug] [--api-token <value>] [--account <value>] 
[-z <value>] [--team-id <value>]
پارامتر    توضیحات    مثال
h- یا help--    نمایش راهنما    liara zone ch -h
account--    برای تغییر موقتی حساب کاربری    liara zone ch --account john_doe
team-id--    
انتخاب تیم با استفاده از شناسه آن

liara zone ch --team-id=your-team-id
api-token--    
برای اجرای آنی عملیات بررسی zone به کمک api token (مناسب ci/cd)

****=liara zone ch --api-token
debug--    برای نمایش لاگ‌های دیباگ    liara zone ch --debug
z- یا zone--    برای درج نام دامنه    liara zone ch -z looms.ir

مشاهده جزئیات دامنه در لیارا با Liara CLI
برای مشاهده جزئیات دامنه در لیارا با Liara CLI، می‌توانید از دستور زیر، استفاده کنید:

liara zone get
پارامترهای دستور
دستور liara zone get، پارامترهای زیر را، می‌پذیرد:

 liara zone get [-h] [--debug] [--api-token <value>] [--account <value>] [--columns
  <value> | -x] [--filter <value>] [--no-header | [--csv | --no-truncate]] [--output csv|json|yaml] [--sort
  <value>] [-z <value>] [--team-id <value>]
پارامتر    توضیحات    مثال
x- یا extended--    نمایش اطلاعات و ستون‌های اضافی دامنه    liara zone get --extended
h- یا help--    نمایش راهنما    liara zone get -h
account--    برای تغییر موقتی حساب کاربری    liara zone get --account alinajmabadi_iran
team-id--    
انتخاب تیم با استفاده از شناسه آن

liara zone get --team-id=your-team-id
api-token--    
برای اجرای آنی عملیات نمایش دامنه به کمک api token (مناسب ci/cd)

****=liara zone get --api-token
debug--    برای نمایش لاگ‌های دیباگ    liara zone get --debug
columns--    برای نمایش فقط ستون‌های انتخاب شده    liara zone get --columns=Status,Name
csv-- یا output=csv--    
برای نمایش خروجی در فرمت CSV

liara zone get --csv
filter--    
برای فیلتر یک ستون با اسم

"liara zone get --filter="name=myapp
no-header--    برای عدم نمایش هدرهای جدول    liara zone get --no-header
no-truncate--    برای جلوگیری از کوتاه شدن یا برش خروجی به اندازه‌ی صفحه نمایش    liara zone get --no-truncate
output--    
برای تعیین فرمت خروجی (CSV , YAML , JSON)

liara zone get --output=json
sort--    
برای مرتب‌سازی بر اساس یک ستون (مرتب‌سازی descending با -)

liara zone get --sort=-Name
z- یا zone--    برای درج نام دامنه    liara zone get -z looms.ir

مشاهده لیست دامنه‌ها با Liara CLI
برای مشاهده لیست دامنه‌ها با Liara CLI، می‌توانید از دستور زیر، استفاده کنید:

liara zone ls # or liara zone list
پارامترهای دستور
دستور liara zone ls یا liara zone list پارامترهای زیر را، می‌پذیرد:

 liara zone ls [-h] [--debug] [--api-token <value>] [--account <value>] [--columns
  <value> | -x] [--filter <value>] [--no-header | [--csv | --no-truncate]] [--output csv|json|yaml] [--sort
  <value>] [--team-id <value>]
پارامتر    توضیحات    مثال
x- یا extended--    نمایش اطلاعات و ستون‌های اضافی دامنه    liara zone ls --extended
h- یا help--    نمایش راهنما    liara zone ls -h
account--    برای تغییر موقتی حساب کاربری    liara zone ls --account alinajmabadi_iran
team-id--    
انتخاب تیم با استفاده از شناسه آن

liara zone ls --team-id=your-team-id
api-token--    
برای اجرای آنی عملیات نمایش دامنه به کمک api token (مناسب ci/cd)

****=liara zone ls --api-token
debug--    برای نمایش لاگ‌های دیباگ    liara zone ls --debug
columns--    برای نمایش فقط ستون‌های انتخاب شده    liara zone ls --columns=Status,Name
csv-- یا output=csv--    
برای نمایش خروجی در فرمت CSV

liara zone ls --csv
filter--    
برای فیلتر یک ستون با اسم

"liara zone ls --filter="name=myapp
no-header--    برای عدم نمایش هدرهای جدول    liara zone ls --no-header
no-truncate--    برای جلوگیری از کوتاه شدن یا برش خروجی به اندازه‌ی صفحه نمایش    liara zone ls --no-truncate
output--    
برای تعیین فرمت خروجی (CSV , YAML , JSON)

liara zone ls --output=json
sort--    
برای مرتب‌سازی بر اساس یک ستون (مرتب‌سازی descending با -)

liara zone ls --sort=-Name
```
