import type { LocalizedSection } from "./docs";

export type { LocalizedSection };

export const faGroups = [
  "شروع کنید",
  "مدل سیستم",
  "ساخت با Studio",
  "عملیات Studio",
  "مرجع",
];

export const faLabels: Record<string, { title: string; group: string; description: string }> = {
  "getting-started": {
    title: "شروع کار",
    group: "شروع کنید",
    description: "نصب پیش‌نیازها، تنظیم فایل‌های محیطی، اجرای استک و تکمیل مراحل Onboarding سازمان.",
  },
  "running-the-platform": {
    title: "راه‌های اجرا",
    group: "شروع کنید",
    description: "تمامی روش‌های پشتیبانی‌شده برای اجرای Studio، موتور CLI، ورکرها، Broker و سرویس‌های جانبی.",
  },
  "first-workflow": {
    title: "اولین Workflow شما",
    group: "شروع کنید",
    description: "آموزش گام‌به‌گام از صفر تا نتیجه: ساخت پروژه، تعریف Agent، طراحی گراف، اجرای Task و تایید انسانی.",
  },
  concepts: {
    title: "مفاهیم اصلی",
    group: "مدل سیستم",
    description: "نحوه‌ی ارتباط Organization، Project، Workspace، Agent، Tool، Workflow، Task، Goal و Run.",
  },
  architecture: {
    title: "معماری",
    group: "مدل سیستم",
    description: "جداسازی Control Plane در Next.js، سرور اجرای Hono، کامپایلر LangGraph و لایه‌ی پایداری.",
  },
  security: {
    title: "مدل امنیتی",
    group: "مدل سیستم",
    description: "مرزهای اعتماد، RBAC، ایزولاسیون RLS در Postgres، حذف Secret از رکوردها و رفتار Fail-Closed.",
  },
  "account-and-workspace": {
    title: "حساب، سازمان و ناوبری",
    group: "ساخت با Studio",
    description: "ثبت‌نام، ساخت سازمان، دعوت اعضا، مدیریت نقش‌ها (Owner/Admin/Member/Viewer) و ناوبری رابط کاربری.",
  },
  "projects-and-workspaces": {
    title: "پروژه‌ها و Workspaceها",
    group: "ساخت با Studio",
    description: "ساخت پروژه، اتصال مخازن Git، تنظیم Branch اختصاصی و مدیریت محیط‌های کاری ایزوله.",
  },
  agents: {
    title: "ساخت و تنظیم Agent",
    group: "ساخت با Studio",
    description: "ثبت Agent با بک‌اندهای API، CLI، Local، Process و Webhook، سیاست اجرایی، ضربان خودکار (Heartbeat) و تست زنده.",
  },
  workflows: {
    title: "طراحی Workflow",
    group: "ساخت با Studio",
    description: "آموزش کامل ۱۰ نوع گره (Node)، ۴ الگوی معماری (Archetype)، تنظیمات هر گام، اجرای زنده‌ی بوم و بسته‌های JSON.",
  },
  tasks: {
    title: "مدیریت Taskها و بورد",
    group: "ساخت با Studio",
    description: "ساخت Task متصل به پروژه و Workspace، تعریف وابستگی‌ها، فیلتر بورد کانبان و کنترل چرخه‌ی اجرا.",
  },
  "tools-and-approvals": {
    title: "Toolها و Approvalها",
    group: "ساخت با Studio",
    description: "ثبت و تست ابزارهای قابل استفاده‌ی مجدد و توقف ایمن گراف در درگاه‌های تایید انسانی.",
  },
  memory: {
    title: "Memory Explorer",
    group: "ساخت با Studio",
    description: "ذخیره، جست‌وجوی برداری و بررسی حافظه‌ی بلندمدت (Semantic، Episodic و Procedural) در سطح سازمان و عامل.",
  },
  "goals-and-delegation": {
    title: "اهداف سازمانی و تفویض",
    group: "عملیات Studio",
    description: "تعریف ساختار گزارش‌دهی (CEO، Manager، Member)، پیشنهاد استراتژی توسط CEO و تفویض اهداف به Task.",
  },
  "routines-and-webhooks": {
    title: "روال‌ها و وب‌هوک‌ها",
    group: "عملیات Studio",
    description: "زمان‌بندی خودکار با Cron و Interval و فراخوانی گردش‌کارها از طریق وب‌هوک‌های امن HMAC-SHA256.",
  },
  "budgets-and-costs": {
    title: "بودجه و کنترل هزینه",
    group: "عملیات Studio",
    description: "تعیین سقف هزینه‌ی ماهانه (USD) برای شرکت، عامل‌ها و پروژه‌ها همراه با رزرو پیش از اجرا.",
  },
  runs: {
    title: "نظارت و بازپخش Runها",
    group: "عملیات Studio",
    description: "استفاده از داشبورد زنده، فیلتر تاریخچه‌ی Run، بررسی تایم‌لاین رویدادها، تاییدها و بازپخش اجرا.",
  },
  persistence: {
    title: "پایداری و بازیابی",
    group: "عملیات Studio",
    description: "چه داده‌هایی پس از ری‌استارت سرور باقی می‌مانند و Runهای متوقف یا در صف چگونه بازیابی می‌شوند.",
  },
  workers: {
    title: "CLI Workerها",
    group: "عملیات Studio",
    description: "اجرای عامل‌های CLI در حالت Local (مورد اعتماد) یا Container ایزوله‌ی بدون دسترسی روت و شبکه.",
  },
  credentials: {
    title: "Credential Broker",
    group: "عملیات Studio",
    description: "صدور Leaseهای تک‌مصرف و کوتاه‌مدت، اعمال سیاست‌ها، زنجیره‌ی ممیزی SHA-256 و اتصال mTLS/Vault.",
  },
  development: {
    title: "راهنمای توسعه",
    group: "مرجع",
    description: "ساختار مونو‌ریپو، کاتالوگ متغیرهای محیطی، مهاجرت دیتابیس و اجرای تست‌های واحد و E2E.",
  },
  deployment: {
    title: "چک‌لیست Deployment",
    group: "مرجع",
    description: "چک‌لیست گام‌به‌گام انتقال از محیط توسعه‌ی محلی به استقرار امن Production.",
  },
  troubleshooting: {
    title: "عیب‌یابی",
    group: "مرجع",
    description: "راهنمای تشخیص و رفع خطاهای ورود، اعتبارسنجی گراف، انسداد Task، تایید انسانی، بودجه و Workerها.",
  },
  limitations: {
    title: "محدودیت‌ها و Roadmap",
    group: "مرجع",
    description: "مرزهای اثبات‌شده در تست‌های خودکار، نیازمندی‌های محیط استقرار و برنامه‌ی توسعه‌ی آینده.",
  },
};

export const faSections: Record<string, LocalizedSection> = {
  "getting-started": {
    title: "شروع کار با Multi-Agent Studio",
    intro:
      "به مستندات جامع و گام‌به‌گام Multi-Agent Studio خوش آمدید. در این بخش پیش‌نیازها را نصب می‌کنید، فایل‌های محیطی (.env) را تنظیم می‌نمایید، دیتابیس PostgreSQL و استک برنامه را بالا می‌آورید، حساب کاربری می‌سازید و اولین سازمان خود را راه‌اندازی می‌کنید.",
    overview: [
      { label: "رابط وب Studio", value: "http://localhost:3060" },
      { label: "سرور اجرا (Hono)", value: "http://localhost:4000" },
      { label: "سایت مستندات", value: "http://localhost:3070" },
      { label: "PostgreSQL محلی", value: "127.0.0.1:55432 (pgvector/pg16)" },
    ],
    code: "pnpm install --frozen-lockfile\npnpm db:dev:up\npnpm db:migrate\npnpm dev",
    items: [
      {
        title: "۱. پیش‌نیازهای سیستم",
        body: "پیش از اجرای دستورات، مطمئن شوید ابزارهای زیر روی سیستم شما نصب هستند:",
        bullets: [
          "Node.js نسخه‌ی 20 یا بالاتر و pnpm نسخه‌ی 10.17.0.",
          "Docker Desktop یا Docker Engine برای اجرای کانتینر PostgreSQL 16 + pgvector و در صورت نیاز کانتینرهای CLI Worker.",
          "Git برای مدیریت مخازن کد و شاخه‌ها (Branches) در Workspaceها.",
          "حداقل یک کلید API از ارائه‌دهندگان مدل (OpenAI، Anthropic یا Google Gemini) یا یک سرور مدل محلی (Ollama / LM Studio).",
        ],
      },
      {
        title: "۲. تنظیم فایل‌های محیطی (.env)",
        body: "در این پلتفرم تنظیمات وب (Control Plane) از کلیدهای حساس سرور اجرا جداست. اپ Next.js در apps/web فایل .env ریشه‌ی مخزن را نمی‌خواند؛ بنابراین هر دو فایل زیر را تنظیم کنید:",
        bullets: [
          "مقادیر مورد نیاز را از .env.example ریشه به apps/server/.env کپی کنید.",
          "فایل apps/web/.env.local را برای احراز هویت Auth.js و ارتباط BFF با سرور اجرا بسازید.",
          "مقدار MEMORY_DATABASE_URL را در هر دو فایل یکسان قرار دهید و هرگز کلیدهای واقعی را در Git کامیت نکنید.",
        ],
        code: `# apps/web/.env.local
AUTH_SECRET="replace-with-32-byte-random-secret"
MEMORY_DATABASE_URL="postgresql://studio_memory:studio_memory_local@127.0.0.1:55432/studio_memory"
EXECUTION_SERVER_URL="http://localhost:4000"
NEXT_PUBLIC_ORG_MEMORY_SCOPE="true"

# apps/server/.env
PORT=4000
STUDIO_STORE="postgres"
MEMORY_DATABASE_URL="postgresql://studio_memory:studio_memory_local@127.0.0.1:55432/studio_memory"
OPENAI_API_KEY="sk-..."`,
        note: "در محیط توسعه می‌توانید پس از اجرای db:migrate دستور pnpm db:seed:dev را اجرا کنید تا داده‌های نمونه‌ی اولیه ساخته شوند.",
      },
      {
        title: "۳. راه‌اندازی دیتابیس، اجرای Migrationها و شروع استک",
        body: "مهاجرت‌های دیتابیس به‌صورت صریح و خارج از زمان بالا آمدن سرور اجرا می‌شوند. دستورات زیر را در ریشه‌ی پروژه اجرا کنید:",
        bullets: [
          "pnpm db:dev:up کانتینر PostgreSQL 16 مجهز به pgvector را روی پورت 55432 اجرا می‌کند.",
          "pnpm db:migrate جداول مربوط به حافظه (Memory) و جداول Studio را ایجاد و به‌روزرسانی می‌کند.",
          "pnpm dev ابتدا بسته‌ی تایپ‌ها را می‌سازد و سپس وب (3060)، سرور اجرا (4000) و مستندات (3070) را هم‌زمان بالا می‌آورد.",
        ],
        code: "pnpm install --frozen-lockfile\npnpm db:dev:up\npnpm db:migrate\npnpm dev",
      },
      {
        title: "۴. ثبت‌نام و ساخت اولین سازمان (Onboarding)",
        body: "مرورگر را باز کرده و به آدرس http://localhost:3060 بروید:",
        bullets: [
          "در صفحه‌ی /register نام، ایمیل و رمز عبور خود را وارد کنید و حساب بسازید.",
          "از صفحه‌ی /login وارد شوید. در اولین ورود، به ویزارد راه‌اندازی سازمان (/onboarding/organization) هدایت می‌شوید.",
          "نام سازمان (مثلاً Acme Studio)، توضیحات اختیاری، منطقه‌ی زمانی پیش‌فرض (مثلاً UTC یا Asia/Tehran) و مجوز دعوت اعضا را مشخص کرده و روی Create organization کلیک کنید.",
          "پس از ساخت، به آدرس اختصاصی سازمان خود (/o/<orgSlug>/projects) منتقل می‌شوید.",
        ],
      },
      {
        title: "۵. بررسی صحت نصب و Build",
        body: "برای اطمینان از سلامت کامل تایپ‌ها، تست‌ها و باندل‌های تولیدی، دستورات زیر را اجرا کنید:",
        code: "pnpm test --runInBand\npnpm --filter server build\npnpm --filter web build\npnpm build:docs",
      },
    ],
    callout: {
      title: "آماده‌ی ساخت اولین گردش‌کار هستید؟",
      body: "به صفحه‌ی «اولین Workflow شما» بروید تا در ۱۰ دقیقه یک پروژه، یک Agent، یک گراف تصویری و یک اجرای واقعی با تایید انسانی بسازید.",
    },
  },

  "running-the-platform": {
    title: "راه‌های اجرای پلتفرم",
    intro:
      "Multi-Agent Studio از چندین حالت اجرا پشتیبانی می‌کند: استک کامل محلی، اجرای تکی هر سرویس، اجرای کامپایل‌شده شبیه Production، سرویس مستقل Credential Broker، ورکرهای کانتینری و موتور CLI کلاسیک.",
    overview: [
      { label: "اجرای پیشنهادی توسعه", value: "pnpm dev" },
      { label: "اجرای بدون سایت Docs", value: "pnpm dev:all" },
      { label: "Credential Broker مستقل", value: "پورت 8484 (src/broker/server.ts)" },
      { label: "موتور CLI ریشه", value: "pnpm dev:cli -- start \"...\"" },
    ],
    code: "pnpm install --frozen-lockfile\npnpm db:dev:up\npnpm db:migrate\npnpm dev",
    items: [
      {
        title: "۱. استک کامل محلی Studio (پیشنهادی)",
        body: "تایپ‌های مشترک را می‌سازد و وب (3060)، سرور اجرا (4000) و سایت مستندات (3070) را با هم اجرا می‌کند.",
        code: "pnpm install --frozen-lockfile\npnpm db:dev:up\npnpm db:migrate\npnpm dev",
      },
      {
        title: "۲. اجرای Studio بدون اپ مستندات",
        body: "زمانی که تنها به رابط کاربری محصول و سرور API نیاز دارید:",
        code: "pnpm db:dev:up\npnpm db:migrate\npnpm dev:all",
      },
      {
        title: "۳. اجرای جداگانه‌ی هر سرویس در زمان توسعه",
        body: "برای تمرکز و دیباگ روی یک بسته به شکل مجزا:",
        bullets: [
          "pnpm build:types — کامپایل تایپ‌های مشترک (@multi-agent/types).",
          "pnpm dev:web — اجرای رابط وب روی پورت 3060.",
          "pnpm dev:server — اجرای سرور Hono روی پورت 4000.",
          "pnpm dev:docs — اجرای سایت مستندات روی پورت 3070.",
        ],
        code: "pnpm build:types\npnpm dev:server\npnpm dev:web\npnpm dev:docs",
      },
      {
        title: "۴. اجرای کامپایل‌شده (شبیه Production)",
        body: "ابتدا هر بسته را build گرفته و سپس فرآیند کامپایل‌شده را اجرا کنید:",
        code: "pnpm --filter server build && pnpm --filter server start\npnpm --filter web build && pnpm --filter web start\npnpm build:docs && pnpm start:docs",
      },
      {
        title: "۵. مدیریت چرخه‌ی عمر دیتابیس",
        body: "شروع، مهاجرت، مقداردهی اولیه (Seed) و ریست دیتابیس PostgreSQL محلی:",
        code: "pnpm db:dev:up\npnpm db:migrate\npnpm db:seed:dev\n# برای ریست کامل یا توقف:\npnpm db:reset\npnpm db:dev:down",
      },
      {
        title: "۶. اجرای سرویس مستقل Credential Broker",
        body: "این سرویس به شکل پیش‌فرض روی پورت 8484 اجرا می‌شود و با pnpm dev بالا نمی‌آید. در محیط Production اتصال Vault، گواهی‌های mTLS و دیتابیس الزامی است.",
        code: `CREDENTIAL_BROKER_SERVICE_TOKENS=dev:local-dev-token \\
CREDENTIAL_BROKER_PORT=8484 \\
npx ts-node src/broker/server.ts

# اجرای مهاجرت جداول پایدار Broker:
CREDENTIAL_BROKER_DATABASE_URL=postgresql://... node infrastructure/broker/migrate.cjs`,
      },
      {
        title: "۷. موتور CLI ریشه و Docker Compose کلاسیک",
        body: "برای اجرای مستقیم گراف Orchestrator از خط فرمان (مستقل از رابط وب Studio) یا بالا آوردن استک قدیمی شامل Langfuse و LangFlow:",
        code: `pnpm dev:cli -- start "Build a hello-world API"
# یا با Docker Compose کلاسیک:
docker compose -f infrastructure/docker/docker-compose.yml up`,
      },
      {
        title: "۸. ساخت ایمیج CLI Worker و اسکریپت‌های ارزیابی",
        body: "برای ساخت و تست ایمیج کانتینر ورکر و اجرای بنچمارک‌های حافظه و بار:",
        code: `pnpm worker:image:build
pnpm worker:image:smoke
pnpm worker:e2e:multi-agent-workflow
pnpm credentials:login-codex

pnpm memory:backfill-embeddings
pnpm memory:eval
pnpm memory:benchmark
pnpm verification:load
pnpm --filter web test:e2e`,
      },
    ],
  },

  "first-workflow": {
    title: "اولین Workflow شما (آموزش عملی گام‌به‌گام)",
    intro:
      "در این آموزش عملی، کوتاه‌ترین مسیر از یک نصب تازه تا اجرای کامل یک گردش‌کار چندمرحله‌ای را طی می‌کنیم: ساخت پروژه، تعریف و تست Agent، طراحی گراف تصویری همراه با تایید انسانی، اجرای Task و بررسی تایم‌لاین زنده.",
    overview: [
      { label: "زمان مورد نیاز", value: "حدود ۱۰ دقیقه" },
      { label: "گام ۱ و ۲", value: "پروژه و Agent (/projects و /org/agents)" },
      { label: "گام ۳", value: "ویرایشگر گراف (/o/<slug>/org)" },
      { label: "گام ۴ و ۵", value: "اجرای Task و تایید Run (/tasks و /runs)" },
    ],
    items: [
      {
        title: "گام ۱: ساخت یک پروژه (Project)",
        body: "تمامی Taskها در Studio به یک پروژه متصل می‌شوند.",
        bullets: [
          "از منوی سمت چپ در بخش Work وارد صفحه‌ی Projects (/o/<orgSlug>/projects) شوید.",
          "در فیلد New project name نامی مانند Customer Portal v1 بنویسید و دکمه‌ی Create را بزنید.",
          "پروژه‌ی شما ساخته می‌شود و تا زمانی که Workspace صریحی نسازید، به‌طور خودکار از Default Workspace استفاده می‌کند.",
        ],
      },
      {
        title: "گام ۲: ثبت و تست اولین Agent",
        body: "Agentها رکوردهای اجرایی قابل استفاده‌ی مجدد در سطح سازمان هستند.",
        bullets: [
          "از منوی سمت چپ در بخش Orchestration وارد Org (/o/<orgSlug>/org) شوید و از پالت سمت چپ یا صفحه‌ی /o/<orgSlug>/org/agents دکمه‌ی Create agent را بزنید.",
          "در صفحه‌ی جزئیات Agent روی Edit agent کلیک کنید، در تب Configuration نام آن را Architecture Reviewer بگذارید و در System prompt دستورالعمل پایه را بنویسید.",
          "به تب Backend بروید، نوع بک‌اند را روی API و Provider را روی openai (یا anthropic / google / local) قرار دهید و روی Save کلیک کنید.",
          "به تب Test بروید و با ورودی نمونه‌ی JSON روی دکمه‌ی Test agent کلیک کنید تا از صحت اتصال کلید API خود مطمئن شوید.",
        ],
      },
      {
        title: "گام ۳: طراحی گراف در Workflow Editor",
        body: "حالا Agent خود را داخل یک گراف اجرایی قرار دهید:",
        bullets: [
          "روی ← Back to Graph Editor کلیک کنید تا به بوم طراحی (/o/<orgSlug>/org) برگردید.",
          "در نوار بالای صفحه روی New workflow کلیک کنید، نام آن را Architecture Review Pipeline بگذارید، الگوی Linear Pipeline را انتخاب و Create را بزنید.",
          "از پالت سمت چپ به ترتیب یک گره Input، عامل Architecture Reviewer، یک گره Approval (تایید انسانی) و یک گره Output به بوم اضافه کنید.",
          "گره‌ها را به ترتیب به هم وصل کنید: Input → Architecture Reviewer → Approval → Output.",
          "یال (Edge) خروجی از Approval به سمت Output را انتخاب کنید و در پنل سمت راست (Properties) نوع یال را Conditional و مقدار Branch Key را برابر approved قرار دهید.",
          "در نوار ابزار بالا روی Validate کلیک کنید تا مطمئن شوید خطایی وجود ندارد و سپس با Ctrl+S گراف را ذخیره کنید.",
        ],
      },
      {
        title: "گام ۴: اجرای مستقیم روی بوم زنده یا از طریق بورد Task",
        body: "می‌توانید گردش‌کار را به یکی از دو روش زیر اجرا کنید:",
        bullets: [
          "روش اول (اجرای زنده روی بوم): در نوار ابزار بالای ویرایشگر، ورودی متنی خود را بنویسید و دکمه‌ی Play (Run workflow) را بزنید. بوم وارد حالت Live · Read only شده و وضعیت هر گره را لحظه‌به‌لحظه نشان می‌دهد.",
          "روش دوم (از طریق Task Board): وارد صفحه‌ی Tasks (/o/<orgSlug>/tasks) شوید، یک Task جدید بسازید، پروژه‌ی Customer Portal v1 و گردش‌کار Architecture Review Pipeline را انتخاب کنید و روی کارت Task دکمه‌ی Start را بزنید.",
        ],
      },
      {
        title: "گام ۵: تایید درگاه انسانی و مشاهده‌ی نتیجه",
        body: "وقتی اجرا به گره Approval می‌رسد، وضعیت Run به waiting_for_human تغییر می‌کند:",
        bullets: [
          "روی بوم زنده (از طریق نوار Live Approval Banner) یا در صفحه‌ی جزئیات اجرا (/o/<orgSlug>/runs/<runId>) پیشنهاد ثبت‌شده را بررسی کرده و روی Approve کلیک کنید.",
          "اجرای گراف بدون تکرار فراخوانی مدل زبانی قبلی ادامه می‌یابد، به گره Output می‌رسد و با وضعیت completed پایان می‌پذیرد.",
        ],
      },
    ],
  },

  concepts: {
    title: "مفاهیم اصلی پلتفرم",
    intro:
      "پیش از کار با بخش‌های پیشرفته‌ی Studio، آشنایی با موجودیت‌های اصلی سیستم و رابطه‌ی آن‌ها باعث می‌شود رفتار تمامی صفحات کاملاً قابل پیش‌بینی باشد.",
    overview: [
      { label: "مرز مالکیت و داده", value: "Organization (tenantId)" },
      { label: "ساختار کد و مخازن", value: "Project → Project Workspace" },
      { label: "قابلیت‌های قابل استفاده مجدد", value: "Agent Registry و Tool Registry" },
      { label: "واحدهای اجرایی", value: "Workflow → Task → Run" },
    ],
    items: [
      {
        title: "۱. سازمان (Organization) و نقش‌های دسترسی",
        body: "هر سازمان یک مستاجر (Tenant) مستقل است و تمام مسیرها با پیشوند /o/<orgSlug>/... بارگذاری می‌شوند. چهار نقش کاربری وجود دارد:",
        bullets: [
          "owner: دسترسی کامل به تمام منابع، مدیریت اعضا، تنظیمات سازمان و حذف سازمان.",
          "admin: مدیریت پروفایل سازمان، دعوت و تعلیق اعضا (به‌جز مالک) و حذف حافظه‌های سطح سازمان.",
          "member: ساخت و ویرایش پروژه، Workspace، Agent، Tool، Workflow، Task، Routine و Webhook.",
          "viewer: دسترسی فقط‌خواندنی برای مشاهده‌ی گراف‌ها، داشبوردها و تاریخچه‌ی اجرا.",
        ],
      },
      {
        title: "۲. تفاوت Project، Project Workspace و بسته‌ی JSON استودیو",
        body: "در Studio مفهوم محیط کاری پروژه از بسته‌ی خروجی گراف‌ها جداست:",
        bullets: [
          "Project (/o/<orgSlug>/projects): ظرف اصلی نگهدارنده‌ی مخازن کد (Repositories)، تنظیمات پایه و Taskها.",
          "Project Workspace (/o/<orgSlug>/workspaces): محیط کاری زیرمجموعه‌ی یک پروژه که مشخص می‌کند کدام مخازن با چه شاخه‌ای (Branch) و با چه تنظیمات اختصاصی (Settings Overrides) استفاده شوند.",
          "Workspace Package در ویرایشگر گراف: فایل JSON قابل Export/Import در بالای صفحه‌ی /o/<orgSlug>/org که شامل آرایه‌های workflows، agents و tools است.",
        ],
      },
      {
        title: "۳. تفاوت رکورد Agent و گره Agent در گراف",
        body: "شما یک بار Agent را در Agent Registry تعریف می‌کنید و بارها در گراف‌های مختلف به آن ارجاع می‌دهید. در هر گره گراف می‌توانید دستورالعمل همان گام (Step Instructions)، تنظیمات دما/توکن، زیرمجموعه‌ی ابزارهای فعال و حالت نشست (Stateless یا Shared) را بدون تغییر رکورد اصلی سفارشی کنید.",
      },
      {
        title: "۴. الگوهای معماری گردش‌کار (Workflow Archetypes)",
        body: "هر Workflow دارای یک Archetype است که قوانین توپولوژی و کامپایل آن را مشخص می‌کند:",
        bullets: [
          "Linear Pipeline: گراف جهت‌دار غیرمدور (DAG) بدون حلقه.",
          "Hierarchical Supervisor: یک گره Agent به‌عنوان ناظر مرکزی (Supervisor Hub) کار را بین عامل‌های متخصص توزیع کرده و با Recursion Guards جلوی حلقه‌های بی‌نهایت را می‌گیرد.",
          "Evaluator-Optimizer: حلقه‌ی بازخورد بین عامل تولیدکننده و عامل ارزیاب تا رسیدن به معیار کیفیت یا سقف تکرار.",
          "Autonomous Swarm: تحویل پویا و همتا‌به‌همتا (Peer Handoff) بین عامل‌ها با سقف پرش مشخص.",
        ],
      },
      {
        title: "۵. تفاوت Task و Run",
        body: "Task یک آیتم کاری مدیریتی روی بورد کانبان است (با اولویت، وابستگی و وضعیت). هر بار که یک Task، Routine یا Webhook اجرا می‌شود، یک Run مستقل با Snapshot تغییرناپذیر، تایم‌لاین رویدادها و رکوردهای تایید انسانی ایجاد می‌گردد.",
      },
    ],
  },

  architecture: {
    title: "معماری سیستم",
    intro:
      "معماری Multi-Agent Studio بر پایه‌ی جداسازی سخت‌گیرانه‌ی لایه‌ی کنترلی مرورگر (Next.js) از لایه‌ی سیاست‌گذاری، کامپایل و اجرای گردش‌کار (Hono + LangGraph) بنا شده است.",
    overview: [
      { label: "Control Plane", value: "apps/web (Next.js 16 + Auth.js + BFF)" },
      { label: "Execution Server", value: "apps/server (Hono + LangGraph)" },
      { label: "ذخیره‌سازی پایدار", value: "PostgreSQL 16 + pgvector + RLS" },
      { label: "ایزولاسیون امنیت", value: "Credential Broker + Container Workers" },
    ],
    items: [
      {
        title: "۱. لایه‌ی Control Plane و BFF (apps/web)",
        body: "اپلیکیشن Next.js رابط کاربری احراز هویت‌شده را رندر می‌کند و درخواست‌های مرورگر را از طریق مسیرهای BFF به سرور اجرا می‌فرستد:",
        bullets: [
          "نشست کاربر را با Auth.js اعتبارسنجی کرده و عضویت فعال او در سازمان (/o/[orgSlug]) را بررسی می‌کند.",
          "Assertion هویت امضاشده با HMAC را به درخواست‌ها الصاق کرده و به سرور Hono ارسال می‌نماید.",
          "هیچ کلید ارائه‌دهنده‌ی مدل یا منطق اجرای ابزار در مرورگر قرار نمی‌گیرد.",
        ],
      },
      {
        title: "۲. سرور اجرا و کامپایلر گراف (apps/server و src/)",
        body: "سرور Hono مرجع نهایی اعتبارسنجی، مجوزدهی و اجرای LangGraph است:",
        bullets: [
          "توپولوژی گراف، قرارداد ورودی/خروجی گره‌ها و قوانین Archetype را پیش از اجرا بررسی می‌کند.",
          "ساختار WorkflowDefinition را به یک StateGraph اجرایی در LangGraph کامپایل می‌کند.",
          "رویدادهای اجرا را به‌صورت بلادرنگ از طریق SSE به مرورگر استریم می‌کند.",
        ],
      },
      {
        title: "۳. زیرسیستم‌های Runtime و پایداری",
        body: "سرویس‌های تخصصی داخل سرور اجرا عبارت‌اند از:",
        bullets: [
          "AgentRuntime و ToolRuntime برای اجرای امن عامل‌ها و ابزارها.",
          "MemoryService مجهز به pgvector برای بازیابی معنایی حافظه‌ی بلندمدت با رعایت مرز مستاجر.",
          "RoutineScheduler و TriggerOutbox برای اجرای زمان‌بندی‌ها و وب‌هوک‌ها.",
          "BudgetService برای رزرو پیش از اجرای بودجه و ثبت هزینه‌ی واقعی.",
        ],
      },
    ],
  },

  security: {
    title: "مدل امنیتی",
    intro:
      "امنیت در Multi-Agent Studio بر اساس مرزهای اعتماد صریح و رفتار Fail-Closed طراحی شده است: ورودی مرورگر غیرقابل اعتماد فرض می‌شود، کلیدها وارد رکوردهای دامنه نمی‌شوند و سرویس‌های Production در صورت نقص تنظیمات امنیتی بالا نمی‌آیند.",
    overview: [
      { label: "اعتماد به مرورگر", value: "غیرقابل اعتماد (اعتبارسنجی کامل در سرور)" },
      { label: "ایزولاسیون مستاجر", value: "RBAC + سیاست‌های RLS در PostgreSQL" },
      { label: "مدیریت Secretها", value: "ممنوعیت در رکوردها + Leaseهای تک‌مصرف Broker" },
      { label: "حالت Production", value: "Fail-Closed بدون بازگشت خاموش به حالت Dev" },
    ],
    items: [
      {
        title: "۱. مرورگر مرجع تصمیم‌گیری امنیتی نیست",
        body: "تمام داده‌های دریافتی از کلاینت (گراف‌ها، تنظیمات Agent، پارامترهای ابزار و شناسه‌ها) در سرور اجرا مجدداً اعتبارسنجی و مجوزدهی می‌شوند.",
      },
      {
        title: "۲. عدم ذخیره‌ی کلیدها در رکوردهای دامنه (assertNoCredentials)",
        body: "توابع اعتبارسنجی از ثبت هرگونه کلید API، توکن یا رمز عبور در فیلدهای Agent، Tool، Workflow و Metadata جلوگیری می‌کنند. اتصال به سرویس‌ها تنها با نام Provider یا نام مستعار (Alias) در Credential Broker انجام می‌شود.",
      },
      {
        title: "۳. ایزولاسیون چندمستاجری با PostgreSQL RLS",
        body: "جداول دیتابیس با کلیدهای ترکیبی tenant_id و سیاست‌های Row-Level Security محافظت می‌شوند تا هیچ مستاجری نتواند داده‌ی سازمان دیگر را بخواند یا تغییر دهد.",
      },
      {
        title: "۴. سندباکس کانتینری Worker و محافظت Anti-SSRF",
        body: "اجرای کدهای غیرقابل اعتماد در کانتینرهای بدون روت، با فایل‌سیستم فقط‌خواندنی، بدون شبکه و پین‌شده با Digest انجام می‌شود. همچنین ابزارهای HTTP و عامل‌های Webhook در برابر فراخوانی آدرس‌های داخلی و متادیتای ابری (SSRF) محافظت شده‌اند.",
      },
    ],
    callout: {
      title: "اصل بنیادین امنیتی",
      body: "هر مرز امنیتی باید یک مالک مشخص، یک بررسی مجوز صریح و یک حالت خطای ایمن (Fail-Closed) داشته باشد.",
    },
  },

  "account-and-workspace": {
    title: "حساب کاربری، سازمان‌ها و ناوبری محیط کار",
    intro:
      "در این بخش نحوه‌ی ثبت‌نام، راه‌اندازی سازمان جدید، جابه‌جایی بین سازمان‌ها، دعوت همکاران با نقش‌های مختلف، تغییر تم ظاهری (تیره/روشن) و مدیریت تنظیمات سازمان را می‌آموزید.",
    overview: [
      { label: "مسیرهای احراز هویت", value: "/register ، /login ، /onboarding/organization" },
      { label: "صفحه‌ی دعوت‌نامه‌ها", value: "/invitations" },
      { label: "تنظیمات سازمان", value: "/o/<orgSlug>/settings" },
      { label: "نقش‌های سازمانی", value: "owner · admin · member · viewer" },
    ],
    items: [
      {
        title: "۱. ثبت‌نام، ورود و ویزارد ساخت سازمان",
        body: "پس از ثبت‌نام در /register و ورود در /login، اگر هنوز عضو سازمانی نباشید به /onboarding/organization هدایت می‌شوید:",
        bullets: [
          "نام سازمان، توضیحات، منطقه‌ی زمانی پیش‌فرض (Default timezone) و گزینه‌ی Allow members to invite others را تنظیم کنید.",
          "اطلاعات فرم در حین تایپ در sessionStorage ذخیره می‌شود تا در صورت رفرش صفحه از دست نرود.",
          "اگر همکارانتان قبلاً شما را دعوت کرده‌اند، روی لینک View organization invitations در بالای صفحه کلیک کنید.",
        ],
      },
      {
        title: "۲. آشنایی با نوار بالا و منوی کناری (App Shell)",
        body: "رابط کاربری Studio از سه بخش اصلی تشکیل شده است:",
        bullets: [
          "هدر بالا: نشانگر وضعیت اتصال زنده (Live)، دکمه‌ی سریع Launch Agent Task برای ارسال فوری کار، دکمه‌ی تغییر تم (تیره/روشن) و منوی کاربری.",
          "سوئیچر سازمان (OrgSwitcher): در بالای منوی سمت چپ برای جابه‌جایی سریع بین سازمان‌ها.",
          "گروه‌های ناوبری منوی چپ: شامل گروه Work (داشبورد، Taskها، پروژه‌ها، Workspaceها)، گروه Orchestration (استودیوی گراف Org، اهداف Goals، روال‌های Routines) و گروه Operations (بودجه Budgets، وب‌هوک‌ها Webhooks، تنظیمات Settings).",
        ],
      },
      {
        title: "۳. ویرایش نام و آدرس (Slug) سازمان",
        body: "کاربران دارای نقش owner یا admin می‌توانند در صفحه‌ی Settings (/o/<orgSlug>/settings) نام و Slug سازمان را تغییر دهند:",
        bullets: [
          "در بخش Organization profile نام یا Slug جدید را وارد کرده و روی Save changes کلیک کنید.",
          "در صورت تغییر Slug، مرورگر به‌طور خودکار به آدرس جدید (/o/<new-slug>/settings) منتقل می‌شود.",
        ],
      },
      {
        title: "۴. دعوت اعضا، پذیرش دعوت‌نامه و مدیریت دسترسی‌ها",
        body: "برای افزودن اعضای تیم به سازمان:",
        bullets: [
          "در صفحه‌ی Settings ایمیل کاربر ثبت‌نام‌شده را وارد کنید، نقش او (admin، member یا viewer) را انتخاب کرده و Invite member را بزنید.",
          "کاربر دعوت‌شده با مراجعه به آدرس /invitations لیست دعوت‌نامه‌های خود را دیده و با زدن Accept invitation وارد سازمان می‌شود.",
          "در جدول اعضای Settings می‌توانید نقش اعضا را تغییر دهید، دسترسی آن‌ها را موقتاً تعلیق (Suspend) و بازیابی (Restore) کنید یا عضویتشان را حذف (Remove) نمایید. آخرین مالک فعال سازمان (Protected owner) قابل حذف یا تنزل نقش نیست.",
        ],
      },
      {
        title: "۵. حذف کامل سازمان (Danger Zone)",
        body: "تنها مالک (owner) سازمان می‌تواند در بخش Danger Zone صفحه‌ی Settings با تایپ دقیق نام سازمان، آن را به همراه تمام پروژه‌ها، گراف‌ها، اجراها و حافظه‌ها برای همیشه پاک کند.",
      },
    ],
  },

  "projects-and-workspaces": {
    title: "مدیریت پروژه‌ها و Project Workspaceها",
    intro:
      "پروژه‌ها مخازن کد، تنظیمات و Taskهای مرتبط با یک محصول را گرد هم می‌آورند. با ساخت Project Workspace می‌توانید برای شاخه‌های مختلف Git یا تنظیمات محیطی متفاوت، فضاهای کاری ایزوله زیرمجموعه‌ی هر پروژه تعریف کنید.",
    overview: [
      { label: "لیست پروژه‌ها", value: "/o/<orgSlug>/projects" },
      { label: "داشبورد پروژه", value: "/o/<orgSlug>/projects/<projectId>" },
      { label: "لیست Workspaceها", value: "/o/<orgSlug>/workspaces" },
      { label: "داشبورد Workspace", value: "/o/<orgSlug>/workspaces/<workspaceId>" },
    ],
    items: [
      {
        title: "۱. ساخت، تغییر نام و بازنشسته‌سازی (Retire) پروژه",
        body: "از منوی سمت چپ وارد Projects (/o/<orgSlug>/projects) شوید:",
        bullets: [
          "نام پروژه را وارد کرده و روی Create کلیک کنید (یا هنگام ساخت Task در بورد کانبان، پروژه را به‌صورت درجا بسازید).",
          "با دکمه‌ی Rename نام پروژه را ویرایش کنید یا با دکمه‌ی Retire پروژه‌های پایان‌یافته را از لیست فعال خارج نمایید.",
        ],
      },
      {
        title: "۲. اتصال مخازن Git در داشبورد پروژه",
        body: "با کلیک روی نام پروژه وارد داشبورد آن (/o/<orgSlug>/projects/<projectId>) شوید:",
        bullets: [
          "در بخش Repositories نام مخزن (Name)، آدرس یا مسیر منبع (Source) و شاخه‌ی پیش‌فرض (Default branch مانند main) را وارد کرده و Attach repository را بزنید.",
          "در صورت حذف مخزن (Remove)، اگر هر یک از Workspaceها تغییرات کامیت‌نشده (Uncommitted changes) روی آن مخزن داشته باشند، سیستم هشدار 409 نشان داده و پیش از حذف، تایید شما را می‌گیرد.",
        ],
      },
      {
        title: "۳. ساخت Project Workspace با شاخه‌های سفارشی",
        body: "هر پروژه تا پیش از ساخت Workspace صریح، از یک فضای پیش‌فرض استفاده می‌کند. برای ساخت فضای کاری اختصاصی (مثلاً Staging یا Feature Lab):",
        bullets: [
          "در داشبورد پروژه (بخش Workspaces) یا در صفحه‌ی /o/<orgSlug>/workspaces نام Workspace را وارد کنید.",
          "اگر پروژه مخازن متصل داشته باشد، می‌توانید در همان لحظه‌ی ساخت انتخاب کنید کدام مخازن با چه Branch اختصاصی در این Workspace حضور داشته باشند.",
        ],
      },
      {
        title: "۴. مدیریت شاخه‌ها، فایل‌های تغییریافته و Settings Overrides",
        body: "وارد داشبورد Workspace (/o/<orgSlug>/workspaces/<workspaceId>) شوید:",
        bullets: [
          "در بخش Repository membership مخازن مورد نظر را تیک بزنید، نام Branch را تغییر دهید و روی Save repository membership کلیک کنید.",
          "وضعیت آمادگی مخزن (ready، branch missing، unavailable)، هشدار تغییرات کامیت‌نشده (uncommitted changes) و لیست دقیق فایل‌های تغییریافته (Changed files) روی کارت هر مخزن نمایش داده می‌شود.",
          "در بخش Configuration می‌توانید در فیلد Settings overrides (JSON) تنظیمات به ارث رسیده از پروژه را بازنویسی کنید یا با دکمه‌ی Clear overrides به تنظیمات پروژه برگردید.",
        ],
      },
    ],
  },

  agents: {
    title: "ساخت و تنظیم Agentها",
    intro:
      "هر Agent یک پیکربندی اجرایی مستقل در Agent Registry سازمان است. می‌توانید Agent را به سرویس‌های ابری LLM، مدل‌های محلی (Ollama / LM Studio)، ابزارهای CLI کدنویسی (Codex، Claude Code، Cursor، Antigravity)، فرآیندهای سیستمی مجاز یا وب‌هوک‌های خارجی متصل کنید.",
    overview: [
      { label: "لیست Agentها", value: "/o/<orgSlug>/org/agents" },
      { label: "صفحه‌ی جزئیات و تست", value: "/o/<orgSlug>/org/agents/<agentId>" },
      { label: "بک‌اندهای پشتیبانی‌شده", value: "API · CLI · Local · Process · Webhook" },
      { label: "تب‌های مدیریت", value: "Overview, Configuration, Backend, Heartbeat, Tools, Memory, Workflows, Executions, Test" },
    ],
    items: [
      {
        title: "۱. ساخت Agent و بررسی وضعیت سلامت (Overview)",
        body: "در صفحه‌ی /o/<orgSlug>/org/agents روی Create agent کلیک کنید (یا در پالت ویرایشگر گراف روی Agent بزنید).",
        bullets: [
          "در تب Overview خلاصه‌ی وضعیت عامل، بک‌اند، تعداد ابزارها، تعداد گردش‌کارهای استفاده‌کننده، پیش‌نمایش System Prompt و نتیجه‌ی بررسی زنده‌ی Backend health نمایش داده می‌شود.",
          "از دکمه‌های بالای صفحه برای کپی کردن عامل (Duplicate)، رفتن به تب تست (Test agent)، ویرایش (Edit agent) یا حذف آن استفاده کنید.",
        ],
      },
      {
        title: "۲. تنظیمات عمومی و System Prompt (تب Configuration)",
        body: "پس از زدن دکمه‌ی Edit agent، در تب Configuration موارد زیر را تنظیم کنید:",
        bullets: [
          "تیک Enabled for execution برای فعال یا غیرفعال کردن موقت عامل.",
          "نام (Name)، توضیحات (Description) و دستورالعمل پایه (System prompt).",
          "فیلد Metadata (JSON) برای متادیتای سفارشی (توجه: ثبت هرگونه کلید یا رمز در این بخش توسط assertNoCredentials مسدود می‌شود).",
        ],
      },
      {
        title: "۳. انتخاب نوع بک‌اند و سیاست اجرایی (تب Backend)",
        body: "در تب Backend یکی از ۵ نوع اجرای پشتیبانی‌شده را انتخاب نمایید:",
        bullets: [
          "API: اتصال به ارائه‌دهندگان ابری (openai، anthropic، google و غیره) همراه با تنظیمات دما (Temperature)، Top P، سقف توکن خروجی و Reasoning effort.",
          "CLI: اجرای عامل‌های خط فرمان (codex، claude، agent برای Cursor، یا agy). در ویندوز حتماً مسیر فایل .exe واقعی را در CLI_AGENT_ALLOWED_EXECUTABLES قرار دهید.",
          "Local: اتصال به سرورهای مدل محلی مانند ollama (پورت 11434) یا lmstudio (پورت 1234).",
          "Process: اجرای باینری یا اسکریپت مجاز تعریف‌شده در لیست سفید سرور به همراه آرگومان‌ها و مسیر Workspace root.",
          "Webhook: ارسال درخواست POST یا PUT به یک سرویس HTTPS خارجی با محافظت Anti-SSRF و نام مستعار Credential Broker.",
          "در بخش Execution policy نیز سطح دسترسی به فایل‌سیستم (none / read / read-write)، شل (disabled / restricted / full)، شبکه و دستورات مجاز را محدود کنید.",
        ],
      },
      {
        title: "۴. تنظیم ضربان و بیداری خودکار عامل (تب Heartbeat)",
        body: "در تب Heartbeat می‌توانید بیداری متناوب و خودکار عامل را فعال کنید تا حتی بدون ارجاع دستی Task، در بازه‌های زمانی مشخص بیدار شده و کارهای خود را بررسی کند:",
        bullets: [
          "تیک فعال‌سازی ضربان را بزنید و فاصله‌ی زمانی (Heartbeat Interval) را به ثانیه وارد کنید (حداقل ۳۰ ثانیه، پیش‌فرض ۳۰۰ ثانیه).",
          "روی Save Heartbeat Settings کلیک کنید. زمان آخرین ضربان و اجرای بعدی در همین پنل نمایش داده می‌شود.",
        ],
      },
      {
        title: "۵. اتصال ابزارها، حافظه و اجرای تست زنده (تب Test)",
        body: "پیش از استفاده از Agent در گردش‌کارهای پیچیده، عملکرد آن را مستقیماً آزمایش کنید:",
        bullets: [
          "در تب Tools ابزارهای ثبت‌شده را به عامل اختصاص دهید و در تب Memory دامنه‌ی حافظه‌ی آن را مشخص کنید.",
          "در تب Test یک شیء JSON نمونه وارد کرده و دکمه‌ی Test agent را بزنید تا خروجی و تایم‌لاین رویدادهای اجرای واقعی را بلافاصله مشاهده کنید.",
        ],
      },
    ],
  },

  workflows: {
    title: "طراحی گردش‌کارهای تصویری (Visual Workflows)",
    intro:
      "ویرایشگر گراف (/o/<orgSlug>/org) محیط بصری طراحی، اعتبارسنجی و مشاهده‌ی زنده‌ی گردش‌کارهاست. در این بخش با ۴ الگوی معماری (Archetypes)، ۱۰ نوع گره، تنظیمات اختصاصی هر گام و اجرای زنده روی بوم آشنا می‌شوید.",
    overview: [
      { label: "آدرس ویرایشگر", value: "/o/<orgSlug>/org" },
      { label: "۴ الگوی معماری", value: "Linear · Supervisor · Evaluator-Optimizer · Swarm" },
      { label: "۱۰ نوع گره", value: "agent, tool, condition, approval, memory, input, output, parallel_split, parallel_join, subgraph" },
      { label: "میانبرهای صفحه‌کلید", value: "Ctrl+S ذخیره · Ctrl+Z بازگشت · Ctrl+Shift+Z تکرار · Del حذف" },
    ],
    items: [
      {
        title: "۱. چهار الگوی معماری گردش‌کار (Workflow Archetypes)",
        body: "هنگام ساخت گردش‌کار جدید (New workflow) یا از پنل Overview سمت راست، می‌توانید الگوی اجرای گراف را انتخاب یا تبدیل کنید:",
        bullets: [
          "Linear Pipeline: اجرای خطی یا موازی بدون حلقه (DAG).",
          "Hierarchical Supervisor: یک گره Agent به‌عنوان ناظر مرکزی (Supervisor Hub) انتخاب می‌شود و با تنظیم Recursion guards (کلید مسیر، حداکثر تکرار ۱ تا ۱۰ و شاخه‌ی Fallback) و سقف گام‌های اجرا (۱ تا ۵۰۰۰) کار را مدیریت می‌کند.",
          "Evaluator-Optimizer: چرخه‌ی تولید و بازبینی بین دو عامل (تولیدکننده و ارزیاب) تا رسیدن به کیفیت مطلوب یا سقف تکرار.",
          "Autonomous Swarm: همکاری پویا و انتقال کنترل بین عامل‌های همتا با محدودیت تعداد پرش.",
        ],
      },
      {
        title: "۲. ده نوع گره (Node Types) و تنظیمات اختصاصی گام Agent",
        body: "گره‌ها را از پالت سمت چپ روی بوم بکشید یا با کلیک اضافه کنید:",
        bullets: [
          "Agent: اجرای یک عامل ثبت‌شده. در پنل سمت راست می‌توانید فقط برای همین گره Step Instructions، بازنویسی تنظیمات مدل (Model settings overrides)، حالت ابزارهای فعال (Inherit، Empty یا Subset) و حالت نشست (Stateless یا Shared با کلید نشست) تعریف کنید.",
          "Tool: فراخوانی مستقیم یک ابزار در نقطه مشخصی از گراف.",
          "Condition: مسیردهی شرطی بر اساس خروجی یا وضعیت همراه با شاخه‌ی پیش‌فرض unknown.",
          "Approval: توقف اجرا برای دریافت تایید یا رد انسانی (شاخه‌های شرطی approved و rejected).",
          "Memory: خواندن یا نوشتن در فضای نام حافظه‌ی بلندمدت.",
          "Input و Output: نقاط ورودی و خروجی گراف.",
          "Parallel Split و Parallel Join: انشعاب اجرای موازی و ادغام مجدد نتایج.",
          "Subgraph: فراخوانی یک گردش‌کار ذخیره‌شده‌ی دیگر به‌عنوان زیرگراف.",
        ],
      },
      {
        title: "۳. اعتبارسنجی (Validate) و اجرای زنده روی بوم (Live Canvas)",
        body: "از نوار ابزار بالای بوم برای چیدمان خودکار (Auto-Arrange)، اعتبارسنجی و اجرای فوری استفاده کنید:",
        bullets: [
          "دکمه‌ی Validate توپولوژی و قراردادها را بررسی کرده و در صورت وجود خطا، مستقیماً روی اولین گره یا فیلد دارای مشکل فوکوس می‌کند.",
          "فرمت ورودی را روی Text یا JSON object بگذارید، متن ورودی را بنویسید و دکمه‌ی Run workflow را بزنید.",
          "در حالت Live، وضعیت اجرای هر گره روی بوم نمایش داده می‌شود، با کلیک روی هر گره بازرس اجرا (Node Execution Inspector) باز می‌شود و تاییدهای انسانی را می‌توانید از نوار بالای بوم انجام دهید.",
        ],
      },
      {
        title: "۴. خروجی و ورودی گرفتن از بسته‌ی Workspace (Export / Import)",
        body: "با دکمه‌های Export workspace و Import workspace در نوار بالای ویرایشگر، می‌توانید کل مجموعه‌ی گردش‌کارها، Agentها و Toolهای خود را در قالب یک فایل JSON استاندارد ذخیره یا بارگذاری کنید.",
      },
    ],
  },

  tasks: {
    title: "مدیریت Taskها و بورد کانبان",
    intro:
      "بورد Tasks (/o/<orgSlug>/tasks) گردش‌کارها و عامل‌های شما را به کارهای عملیاتی قابل پیگیری، اولویت‌بندی، فیلتر و اجرا تبدیل می‌کند.",
    overview: [
      { label: "آدرس بورد Task", value: "/o/<orgSlug>/tasks" },
      { label: "ارسال سریع از هدر", value: "دکمه‌ی Launch Agent Task در نوار بالا" },
      { label: "ستون‌های بورد", value: "Backlog · In Progress · Review · Done" },
      { label: "لینک مستقیم", value: "/o/<orgSlug>/tasks?taskId=<id>" },
    ],
    items: [
      {
        title: "۱. ساخت Task و ارسال سریع (Quick Dispatch)",
        body: "برای ثبت کار جدید می‌توانید از دکمه‌ی + بالای هر ستون در صفحه‌ی /o/<orgSlug>/tasks استفاده کنید، یا از هر جای برنامه روی دکمه‌ی Launch Agent Task در هدر بالا کلیک کرده و نیازمندی خود را مستقیماً به صف اجرا بفرستید.",
      },
      {
        title: "۲. اتصال Task به پروژه، Workspace، گردش‌کار و وابستگی‌ها",
        body: "در پنجره‌ی Create Task جزئیات زیر را مشخص کنید:",
        bullets: [
          "عنوان (Title)، توضیحات (Description)، اولویت (Priority) و ستون وضعیت اولیه.",
          "انتخاب Project (یا ساخت پروژه‌ی جدید در همان پنجره) و انتخاب Project Workspace مربوطه.",
          "انتخاب Workflow و Agent مسئول اجرا.",
          "تعیین Task والد (Parent Task) و وابستگی‌ها (Dependencies): تا زمانی که Taskهای پیش‌نیاز کامل نشوند، شروع یا انتقال این Task مسدود خواهد بود.",
        ],
      },
      {
        title: "۳. فیلتر کردن، اجرای Task و مدیریت چرخه‌ی عمر",
        body: "از نوار فیلتر بالای بورد برای جست‌وجو بر اساس متن، پروژه، Workspace، عامل، گردش‌کار یا اولویت استفاده کنید (فیلترها در URL ذخیره می‌شوند). روی هر کارت می‌توانید عملیات Start، Pause/Resume، Retry، Cancel و Delete را اجرا کرده یا پنل جزئیات کامل Task را باز کنید.",
      },
    ],
  },

  "tools-and-approvals": {
    title: "Toolها و درگاه‌های تایید انسانی (Approvals)",
    intro:
      "ابزارها قابلیت‌های ثبت‌شده و تحت کنترل سرور هستند و درگاه‌های Approval امکان توقف ایمن اجرای گراف برای تصمیم‌گیری اپراتور انسانی را فراهم می‌کنند.",
    overview: [
      { label: "لیست ابزارها", value: "/o/<orgSlug>/org/tools" },
      { label: "جزئیات و تست ابزار", value: "/o/<orgSlug>/org/tools/<toolId>" },
      { label: "سطوح اثرگذاری", value: "low · medium · high · critical" },
      { label: "شاخه‌های خروجی تایید", value: "approved · rejected" },
    ],
    items: [
      {
        title: "۱. ثبت، تنظیم و تست ابزار در Tool Registry",
        body: "در صفحه‌ی /o/<orgSlug>/org/tools روی Create tool کلیک کنید:",
        bullets: [
          "در تب Configuration نام، دسته‌بندی (Category)، سطح اثرگذاری (Impact)، توضیحات و پیکربندی JSON ابزار را بدون قرار دادن کلیدهای محرمانه وارد کنید.",
          "در تب Overview اسکیمای ورودی و خروجی (Input/Output Schema) را بررسی کنید.",
          "در تب Test با داده‌ی JSON نمونه ابزار را به‌صورت مستقل تست کنید و در تب‌های Agents و Workflows موارد استفاده‌ی آن را ببینید.",
        ],
      },
      {
        title: "۲. طراحی و پاسخ به درگاه تایید انسانی (Human Approval Gate)",
        body: "برای متوقف کردن گردش‌کار پیش از اقدامات حساس:",
        bullets: [
          "یک گره Approval به گراف اضافه کنید و دو یال خروجی از نوع Conditional با کلیدهای شاخه‌ی approved و rejected از آن به گره‌های بعدی بکشید.",
          "وقتی اجرا به این گره می‌رسد، وضعیت Run به waiting_for_human تغییر می‌کند.",
          "اپراتور در صفحه‌ی Run (/o/<orgSlug>/runs/<runId>) یا مستقیماً روی بوم زنده پیشنهاد را بررسی کرده و Approve یا Reject را می‌زند تا اجرا دقیقاً از همان نقطه‌ی Checkpoint ادامه یابد.",
        ],
      },
    ],
  },

  memory: {
    title: "Memory Explorer و حافظه‌ی بلندمدت",
    intro:
      "علاوه بر وضعیت کوتاه‌مدت هر اجرا، Multi-Agent Studio دارای حافظه‌ی بلندمدت برداری مبتنی بر PostgreSQL و pgvector است. با Memory Explorer (/o/<orgSlug>/org/memory) می‌توانید حافظه‌ها را در دامنه‌های مختلف جست‌وجو و مدیریت کنید.",
    overview: [
      { label: "آدرس Memory Explorer", value: "/o/<orgSlug>/org/memory" },
      { label: "دامنه‌ها (Scopes)", value: "organization · agent · workflow · project · user" },
      { label: "انواع حافظه (Kinds)", value: "semantic · episodic · procedural" },
      { label: "موتور ذخیره‌سازی", value: "PostgreSQL 16 + pgvector" },
    ],
    items: [
      {
        title: "۱. دامنه‌ها (Scopes) و انواع حافظه (Kinds)",
        body: "هر رکورد حافظه در یک فضای نام مشخص ({ scope, id }) ذخیره می‌شود:",
        bullets: [
          "Scopeها: شامل agent، workflow، project، user و در صورت فعال بودن NEXT_PUBLIC_ORG_MEMORY_SCOPE دامنه‌ی کل سازمان (organization).",
          "semantic: دانش، واقعیت‌ها و تصمیمات معماری.",
          "episodic: خلاصه‌ی تجربیات و رخدادهای اجراهای پیشین.",
          "procedural: روش‌های انجام کار و الگوهای موفق.",
        ],
      },
      {
        title: "۲. فهرست کردن، جست‌وجوی معنایی و حذف حافظه‌ها",
        body: "در صفحه‌ی /o/<orgSlug>/org/memory:",
        bullets: [
          "دامنه (Namespace scope) و شناسه‌ی آن (Namespace ID) را انتخاب کنید و در صورت نیاز نوع حافظه (Kind filter) را فیلتر نمایید.",
          "برای مشاهده‌ی ۵۰ رکورد آخر روی List recent کلیک کنید، یا عبارت مورد نظر را در Search text نوشته و روی Search بزنید تا بازیابی برداری بر اساس امتیاز ارتباط انجام شود.",
          "با کلیک روی هر ردیف، ساختار کامل JSON و منبع ثبت آن (agentId، runId، workflowId) باز می‌شود. حذف حافظه‌های سطح سازمان نیازمند نقش owner یا admin است.",
        ],
      },
    ],
  },

  "goals-and-delegation": {
    title: "اهداف سازمانی، ساختار گزارش‌دهی و تفویض کار",
    intro:
      "در صفحه‌ی Organization & Goals (/o/<orgSlug>/organization) می‌توانید ساختار سلسله‌مراتبی عامل‌ها (CEO، Manager، Member) را تعریف کنید، از عامل مدیرعامل (CEO) درخواست پیشنهاد استراتژی نمایید و اهداف تاییدشده را به Taskهای عملیاتی تبدیل کنید.",
    overview: [
      { label: "آدرس صفحه", value: "/o/<orgSlug>/organization" },
      { label: "محل در منوی کناری", value: "Orchestration → Goals" },
      { label: "نقش‌های سلسله‌مراتبی", value: "CEO · Manager · Member" },
      { label: "وضعیت‌های هدف", value: "proposed · active · completed · cancelled" },
    ],
    items: [
      {
        title: "۱. تعریف خطوط گزارش‌دهی عامل‌ها (Reporting Lines)",
        body: "در بخش Reporting lines در بالای صفحه‌ی /o/<orgSlug>/organization:",
        bullets: [
          "برای هر Agent نقش سازمانی آن (CEO، Manager یا Member) و مدیر مستقیمش (Manager) را انتخاب کرده و روی Save کلیک کنید.",
          "تعیین حداقل یک عامل با نقش CEO امکان ثبت درخواست استراتژی خودکار را فعال می‌کند.",
        ],
      },
      {
        title: "۲. ثبت هدف جدید و پیشنهاد استراتژی توسط CEO",
        body: "در فرم New goal می‌توانید یک هدف شرکتی یا زیرهدف تعریف کنید:",
        bullets: [
          "عنوان (Goal title)، توضیحات، عامل مسئول (Goal owner agent)، هدف والد (Parent goal) و پروژه‌ی مرتبط را انتخاب کنید.",
          "اگر گزینه‌ی CEO strategy proposal را تیک بزنید، هدف با وضعیت proposed ساخته می‌شود و یک Task استراتژی برای عامل CEO ارسال می‌گردد.",
          "پس از تکمیل Task استراتژی توسط CEO و تولید خروجی، دکمه‌ی Approve روی هدف فعال می‌شود تا آن را به وضعیت active تغییر دهید.",
        ],
      },
      {
        title: "۳. تفویض اهداف فعال به Task و پیگیری پیشرفت",
        body: "در بخش Goal tree، برای هر هدف active می‌توانید عامل مورد نظر (و در صورت نیاز پروژه) را انتخاب کرده و روی Delegate to task کلیک کنید. سیستم یک Task متصل به آن هدف در بورد کانبان می‌سازد و درصد پیشرفت و خروجی Taskها را زیر همان هدف نمایش می‌دهد.",
      },
    ],
  },

  "routines-and-webhooks": {
    title: "روال‌های زمان‌بندی‌شده (Routines) و وب‌هوک‌های ورودی",
    intro:
      "برای اجرای خودکار گردش‌کارها و عامل‌ها بدون دخالت دستی، از صفحه‌ی Routines (/o/<orgSlug>/routines) برای زمان‌بندی‌های Cron/Interval و از صفحه‌ی Webhooks (/o/<orgSlug>/webhooks) برای دریافت رویدادهای خارجی امضاشده با HMAC-SHA256 استفاده کنید.",
    overview: [
      { label: "مسیر Routines", value: "/o/<orgSlug>/routines (Orchestration → Routines)" },
      { label: "مسیر Webhooks", value: "/o/<orgSlug>/webhooks (Operations → Webhooks)" },
      { label: "انواع زمان‌بندی", value: "Cron Expression · Interval (every:Ns)" },
      { label: "امنیت وب‌هوک", value: "امضای HMAC-SHA256 + محدودیت نرخ درخواست" },
    ],
    items: [
      {
        title: "۱. تعریف روال زمان‌بندی‌شده (Routine)",
        body: "در صفحه‌ی /o/<orgSlug>/routines روی دکمه‌ی Create Routine (تعریف روال جدید) کلیک کنید:",
        bullets: [
          "نوع زمان‌بندی را روی Cron Expression (مثلاً 0 9 * * 1-5) یا Interval (مثلاً every:300s) بگذارید و منطقه‌ی زمانی (Timezone مانند UTC یا Asia/Tehran) را وارد کنید.",
          "با زدن دکمه‌ی Preview Next Runs (پیش‌نمایش ۵ اجرای بعدی) زمان دقیق اجراهای آتی را پیش از ذخیره بررسی کنید.",
          "نوع مقصد (Workflow یا Agent)، شناسه‌ی مقصد (Target ID) و سیاست تعویق (Misfire Policy: شامل Skip، Coalesce یا Enqueue) را انتخاب و ذخیره کنید.",
          "از دکمه‌های روی هر کارت برای توقف/ادامه (Pause/Resume)، مشاهده‌ی تاریخچه‌ی اجرا (History) و حذف استفاده کنید.",
        ],
      },
      {
        title: "۲. ساخت محرک وب‌هوک ورودی (Inbound Webhook Trigger)",
        body: "در صفحه‌ی /o/<orgSlug>/webhooks روی Create Webhook Trigger کلیک کنید:",
        bullets: [
          "عنوان، توضیحات، نوع و شناسه‌ی مقصد (Workflow یا Agent) و سقف نرخ درخواست در دقیقه (Rate Limit) را مشخص کنید.",
          "پس از ساخت، کلید امضای وب‌هوک (signingSecret) فقط یک بار نمایش داده می‌شود؛ آن را کپی و در جای امن ذخیره کنید.",
        ],
      },
      {
        title: "۳. ارسال درخواست امضاشده و بررسی سوابق دریافت (Delivery Log)",
        body: "فرستنده باید بدنه‌ی خام JSON را با کلید امضا و الگوریتم HMAC-SHA256 امضا کرده و به آدرس POST /api/webhooks/triggers/<triggerId> بفرستد. همچنین با آیکون کلید می‌توانید کلید امضا را بازنشانی (Rotate) و با آیکون Activity گزارش درخواست‌های دریافتی (ACCEPTED / REJECTED) را بررسی کنید.",
        code: `BODY='{"event":"pull_request.opened","pr":42}'
SECRET="your-webhook-signing-secret"
SIG=$(printf "%s" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')

curl -X POST "http://localhost:4000/api/webhooks/triggers/<triggerId>" \\
  -H "Content-Type: application/json" \\
  -H "X-Hub-Signature-256: sha256=$SIG" \\
  -d "$BODY"`,
      },
    ],
  },

  "budgets-and-costs": {
    title: "بودجه‌بندی و کنترل هزینه (Cost Budgets)",
    intro:
      "صفحه‌ی Cost Budgets (/o/<orgSlug>/budgets) امکان تعیین سقف هزینه‌ی ماهانه به دلار (USD) را در سه سطح شرکت (Company)، عامل (Agent) و پروژه (Project) فراهم می‌کند تا پیش از فراخوانی مدل زبانی، بودجه رزرو و کنترل شود.",
    overview: [
      { label: "آدرس صفحه", value: "/o/<orgSlug>/budgets" },
      { label: "محل در منو", value: "Operations → Budgets" },
      { label: "سطوح بودجه", value: "Company · Agent · Project" },
      { label: "نحوه‌ی اعمال", value: "رزرو پیش از اجرا (Fail-Closed)" },
    ],
    items: [
      {
        title: "۱. سازوکار رزرو بودجه پیش از اجرا",
        body: "پیش از هر فراخوانی Agent، مقدار تخمینی هزینه در فیلد reservedUsd رزرو می‌شود. اگر مجموع spentUsd + reservedUsd از سقف limitUsd عبور کند، اجرا پیش از ارسال درخواست به ارائه‌دهنده‌ی LLM متوقف می‌شود و پس از اتمام موفق، هزینه‌ی واقعی جایگزین مبلغ رزروشده می‌گردد.",
      },
      {
        title: "۲. تنظیم سقف بودجه و آستانه‌ی هشدار",
        body: "در صفحه‌ی /o/<orgSlug>/budgets:",
        bullets: [
          "دامنه‌ی بودجه (Company، Agent یا Project) و هدف آن را انتخاب کنید.",
          "مبلغ سقف ماهانه (Monthly USD) و درصد هشدار (Alert at % مثلاً 80%) را وارد کرده و Save budget را بزنید.",
          "در بخش Current period نوار پیشرفت مصرف و در بخش Alerts تاریخچه‌ی عبور از آستانه‌ی هشدار یا سقف بودجه را مشاهده کنید.",
        ],
      },
    ],
  },

  runs: {
    title: "نظارت، کنترل و بازپخش Runها",
    intro:
      "هر اجرای گردش‌کار یا Task یک رکورد Run ایجاد می‌کند که از طریق داشبورد زنده (/o/<orgSlug>)، فهرست تاریخچه (/o/<orgSlug>/runs) و صفحه‌ی جزئیات اجرا (/o/<orgSlug>/runs/<runId>) قابل رصد و بازپخش است.",
    overview: [
      { label: "داشبورد زنده", value: "/o/<orgSlug>" },
      { label: "تاریخچه‌ی اجراها", value: "/o/<orgSlug>/runs" },
      { label: "جزئیات و بازپخش", value: "/o/<orgSlug>/runs/<runId>" },
      { label: "وضعیت‌ها", value: "queued · running · waiting_for_human · completed · failed · cancelled" },
    ],
    items: [
      {
        title: "۱. داشبورد عملیاتی زنده (/o/<orgSlug>)",
        body: "صفحه‌ی اصلی سازمان کارت‌های آماری، پیش‌نمایش گراف، عامل‌های در حال اجرا، صف کارها و تحلیل مصرف توکن و هزینه را به‌صورت زنده نمایش می‌دهد.",
      },
      {
        title: "۲. فیلتر تاریخچه‌ی Runها (/o/<orgSlug>/runs)",
        body: "در صفحه‌ی Runs می‌توانید اجراها را بر اساس شناسه‌ی Workflow، شناسه‌ی Task، وضعیت و بازه‌ی زمانی فیلتر کنید.",
      },
      {
        title: "۳. بررسی گراف زمان اجرا، تایم‌لاین رویدادها و کنترل Run",
        body: "در صفحه‌ی /o/<orgSlug>/runs/<runId> وضعیت هر گره و یال‌های طی‌شده در سمت چپ و تایم‌لاین کامل رویدادها در سمت راست نمایش داده می‌شود. همچنین می‌توانید با Open on canvas اجرا را روی بوم گراف باز کنید، اجرای فعال را Cancel نمایید یا اجرای ناموفق را Retry کنید.",
      },
    ],
  },

  persistence: {
    title: "پایداری داده و بازیابی پس از ری‌استارت",
    intro:
      "با ذخیره‌سازی پایدار در PostgreSQL، سازمان‌ها، پروژه‌ها، گراف‌ها، Taskها، Snapshotهای اجرا، Checkpointهای تایید انسانی و حافظه‌ی بلندمدت در برابر ری‌استارت سرور مقاوم هستند.",
    overview: [
      { label: "مخزن پایدار", value: "PostgreSQL 16 (STUDIO_STORE=postgres)" },
      { label: "ایزولاسیون نسخه", value: "Snapshot تغییرناپذیر در لحظه‌ی شروع Run" },
    ],
    items: [
      {
        title: "۱. Snapshotهای تغییرناپذیر اجرا",
        body: "در لحظه‌ی شروع هر Run، یک کپی ثابت از گراف، Agentها و Toolها ذخیره می‌شود تا تغییرات بعدی در ویرایشگر، اجراهای در جریان یا تاریخچه‌ی قبلی را مختل نکند.",
      },
      {
        title: "۲. رفتار سیستم پس از ری‌استارت سرور",
        body: "Runهای در صف (queued) از روی Snapshot بازیابی می‌شوند و Runهای منتظر تایید انسانی (waiting_for_human) پس از ثبت Approve/Reject بدون تکرار فراخوانی‌های قبلی LLM از نقطه‌ی Checkpoint ادامه می‌یابند.",
      },
    ],
  },

  workers: {
    title: "CLI Workerها (حالت Local در برابر Container)",
    intro:
      "عامل‌های مبتنی بر CLI (مانند Codex، Claude Code، Cursor و Antigravity) در دو حالت Local (مخصوص کدهای مورد اعتماد در محیط توسعه) و Container (ایزوله‌ی کامل برای کدهای غیرقابل اعتماد) اجرا می‌شوند.",
    overview: [
      { label: "حالت توسعه‌ی محلی", value: "CLI_WORKER_MODE=local" },
      { label: "حالت کانتینر ایزوله", value: "CLI_WORKER_MODE=container" },
    ],
    code: "pnpm worker:image:build\npnpm worker:image:smoke\npnpm worker:e2e:multi-agent-workflow",
    items: [
      {
        title: "۱. تفاوت حالت Local و Container",
        body: "حالت Local فرآیند را روی سیستم میزبان با بررسی لیست سفید باینری‌ها اجرا می‌کند. حالت Container از ایمیج پین‌شده با Digest، کاربر غیر روت، فایل‌سیستم فقط‌خواندنی، حذف Capabilityها و شبکه‌ی خاموش پیش‌فرض بهره می‌برد.",
      },
      {
        title: "۲. ساخت ایمیج و احراز هویت عامل‌های CLI",
        body: "با دستورات pnpm worker:image:build و pnpm worker:image:smoke ایمیج را بسازید و تست کنید و در صورت نیاز با pnpm credentials:login-codex فایل احراز هویت ایزوله را آماده نمایید.",
      },
    ],
  },

  credentials: {
    title: "سرویس Credential Broker",
    intro:
      "Credential Broker کلیدهای ارائه‌دهندگان را در قالب Leaseهای کوتاه‌مدت، تک‌مصرف و مقید به مستاجر و Run صادر می‌کند تا هیچ کلید خامی وارد دیتابیس گراف یا مرورگر نشود.",
    overview: [
      { label: "مسیرهای API", value: "POST /v1/leases · /consume · /revoke · GET /v1/health · /v1/audit/leases" },
      { label: "پورت پیش‌فرض", value: "8484" },
      { label: "یکپارچگی ممیزی", value: "زنجیره‌ی هش SHA-256 و جدول Append-Only" },
    ],
    items: [
      {
        title: "۱. چرخه‌ی صدور، مصرف اتمیک و ابطال Lease",
        body: "سرور اجرا پیش از فراخوانی ارائه‌دهنده، یک Lease کوتاه‌مدت درخواست کرده و آن را به‌صورت اتمیک و تک‌مصرف (Single-Use) مصرف می‌کند.",
      },
      {
        title: "۲. اعمال سیاست‌ها، سقف نرخ و زنجیره‌ی ممیزی SHA-256",
        body: "تمامی درخواست‌ها در برابر عضویت مستاجر، مجوز عامل/ابزار و بودجه بررسی شده و در جدول ممیزی غیرقابل ویرایش (Append-Only) با زنجیره‌ی هش SHA-256 ثبت می‌شوند.",
      },
    ],
  },

  development: {
    title: "راهنمای توسعه و تست",
    intro:
      "مرجع ساختار پوشه‌های مونو‌ریپو، متغیرهای محیطی کلیدی و دستورات تست و تایپ‌چک برای توسعه‌دهندگان.",
    code: "pnpm test --runInBand\nnpx tsc --noEmit\npnpm --filter server build\npnpm --filter web build\npnpm build:docs",
    items: [
      {
        title: "۱. ساختار بسته‌ها در مونو‌ریپو",
        body: "پوشه‌ی packages/types شامل قراردادهای مشترک، src/ شامل موتور کامپایلر و Broker، پوشه‌ی apps/server سرور Hono، پوشه‌ی apps/web رابط Next.js و apps/docs سایت مستندات دوزبانه است.",
      },
      {
        title: "۲. اجرای تست‌ها و بررسی کیفیت کد",
        body: "پیش از ثبت تغییرات، تست‌های Jest، تایپ‌چک و Build بسته‌ها را اجرا کنید.",
      },
    ],
  },

  deployment: {
    title: "چک‌لیست استقرار Production",
    intro:
      "گام‌های ضروری برای انتقال امن Multi-Agent Studio از محیط توسعه به محیط عملیاتی.",
    items: [
      {
        title: "۱. دیتابیس، مهاجرت‌ها و بک‌آپ",
        body: "اسکریپت‌های مهاجرت memory، studio و broker را در گام انتشار اجرا کنید و از فعال بودن STUDIO_STORE=postgres و تست بازگردانی بک‌آپ مطمئن شوید.",
      },
      {
        title: "۲. استقرار Credential Broker، Vault و Container Worker",
        body: "در محیط Production متغیر CREDENTIAL_BROKER_FAIL_CLOSED=true، گواهی‌های mTLS، اتصال HashiCorp Vault و ایمیج پین‌شده‌ی کانتینر ورکر (@sha256) را تنظیم و راستی‌آزمایی کنید.",
      },
    ],
  },

  troubleshooting: {
    title: "راهنمای عیب‌یابی (Troubleshooting)",
    intro:
      "راهنمای سریع تشخیص و برطرف کردن خطاهای رایج در احراز هویت، اعتبارسنجی گراف، اجرای Task، تایید انسانی و Workerها.",
    items: [
      {
        title: "۱. خطای ورود یا دریافت 404 در مسیر /o/<orgSlug>",
        body: "اجرای دیتابیس (pnpm db:dev:up)، اعمال مهاجرت‌ها (pnpm db:migrate) و یکسان بودن MEMORY_DATABASE_URL و AUTH_SECRET را بررسی کنید. همچنین مطمئن شوید کاربر فعلی عضو فعال آن سازمان است.",
      },
      {
        title: "۲. غیرفعال بودن دکمه‌ی Run در ویرایشگر گراف",
        body: "روی دکمه‌ی Validate در نوار ابزار کلیک کنید تا اولین گره یا تنظیم دارای خطا (مانند حلقه در Linear Pipeline یا نبودن Supervisor Hub) مشخص شود.",
      },
      {
        title: "۳. عدم شروع Task یا توقف در waiting_for_human",
        body: "اگر Task به دلیل وابستگی مسدود است، ابتدا Taskهای پیش‌نیاز را کامل کنید. اگر وضعیت Run روی waiting_for_human است، از پنل Approval در صفحه‌ی Run یا روی بوم زنده، پیشنهاد را Approve یا Reject نمایید.",
      },
      {
        title: "۴. خطای اجرای CLI Agent در ویندوز",
        body: "در ویندوز به جای اسکریپت‌های .cmd، مسیر فایل .exe اصلی را در CLI_AGENT_ALLOWED_EXECUTABLES قرار دهید.",
      },
    ],
  },

  limitations: {
    title: "محدودیت‌های فعلی و نقشه‌ی راه (Roadmap)",
    intro:
      "مرور 투명 آنچه در تست‌های خودکار اثبات شده، آنچه وابسته به محیط استقرار است و اولویت‌های بعدی توسعه.",
    items: [
      {
        title: "۱. ملاحظات استقرار چندنمونه‌ای (Multi-Instance)",
        body: "محدودکننده‌های نرخ (Rate Limiters) فعلی در حافظه‌ی فرآیند هستند و برای چیدمان چندنمونه‌ای نیازمند ذخیره‌ساز مشترک یا API Gateway هستند.",
      },
      {
        title: "۲. گام‌های بعدی نقشه‌ی راه",
        body: "پشتیبانی از Rate Limit توزیع‌شده، مصرف مستقیم Lease توسط کانتینر Worker و گسترش ردیابی OpenTelemetry / Langfuse در زیرگراف‌ها.",
      },
    ],
  },
};
