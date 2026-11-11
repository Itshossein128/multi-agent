import Link from "next/link";
import { ArrowLeft, CheckCircle2, LockKeyhole, Network, Terminal } from "lucide-react";
import { docPages } from "@/lib/docs";
import { faGroups, faLabels } from "@/lib/faDocs";

const learningSteps = [
  {
    number: "۰۱",
    title: "نصب و راه‌اندازی سازمان",
    text: "اجرای PostgreSQL، اعمال Migrationها، ساخت حساب کاربری و تکمیل ویزارد سازمان.",
    slug: "getting-started",
  },
  {
    number: "۰۲",
    title: "پروژه‌ها و Workspaceها",
    text: "ساخت پروژه، اتصال مخازن Git و تعریف Workspaceهای ایزوله با Branch اختصاصی.",
    slug: "projects-and-workspaces",
  },
  {
    number: "۰۳",
    title: "ساخت Agent و Tool",
    text: "تعریف عامل‌های API، CLI یا Local، تنظیم سیاست‌های امنیتی، ضربان خودکار و تست زنده.",
    slug: "agents",
  },
  {
    number: "۰۴",
    title: "طراحی گراف Workflow",
    text: "کار با ۱۰ نوع گره و ۴ الگوی معماری (Linear، Supervisor، Evaluator-Optimizer و Swarm).",
    slug: "workflows",
  },
  {
    number: "۰۵",
    title: "مدیریت Task، تایید و Run",
    text: "اجرای کار در بورد کانبان، پاسخ به درگاه تایید انسانی و بررسی تایم‌لاین زنده‌ی رویدادها.",
    slug: "tasks",
  },
  {
    number: "۰۶",
    title: "اتوماسیون، اهداف و بودجه",
    text: "تفویض اهداف سازمانی، زمان‌بندی Routines، وب‌هوک‌های HMAC و سقف بودجه‌ی دلاری.",
    slug: "goals-and-delegation",
  },
];

export default function PersianHomePage() {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <span className="status-pill">
            <span className="pulse" /> آموزش جامع کاربری · ۲۴ راهنمای گام‌به‌گام
          </span>
          <h1>
            تسلط کامل بر Multi-Agent Studio
            <br />
            <span>از نصب اولیه تا عملیات Production.</span>
          </h1>
          <p>
            راهنمای آموزشی کامل و گام‌به‌گام برای کار با تمامی بخش‌های Multi-Agent Studio:
            سازمان‌ها، پروژه‌ها، Workspaceها، ساخت Agent و Tool، طراحی گراف‌های تصویری، بورد کانبان
            Taskها، تایید انسانی، حافظه‌ی بلندمدت، اهداف سازمانی، زمان‌بندی‌ها، وب‌هوک‌ها و کنترل بودجه.
          </p>
          <div className="hero-actions">
            <Link className="button primary" href="/fa/docs/getting-started">
              شروع آموزش گام‌به‌گام <ArrowLeft size={16} />
            </Link>
            <Link className="button secondary" href="/fa/docs/first-workflow">
              اولین Workflow در ۱۰ دقیقه
            </Link>
          </div>
        </div>
        <div className="hero-visual" aria-label="پیش‌نمایش معماری پلتفرم">
          <div className="visual-grid" />
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="core-node">
            <Network size={26} />
            <span>AgentRuntime</span>
          </div>
          <div className="floating-node node-a">
            <Terminal size={16} />
            <span>Workflow</span>
          </div>
          <div className="floating-node node-b">
            <LockKeyhole size={16} />
            <span>Policy</span>
          </div>
          <div className="floating-node node-c">
            <CheckCircle2 size={16} />
            <span>RunStore</span>
          </div>
        </div>
      </section>

      <section className="signal-row">
        <div>
          <strong>وب Studio (:3060) و سرور (:4000)</strong>
          <span>رابط کنترلی Next.js به همراه موتور اجرایی Hono و LangGraph</span>
        </div>
        <div>
          <strong>۴ الگوی معماری و ۱۰ نوع گره</strong>
          <span>پشتیبانی از Linear DAG، Supervisor، Evaluator-Optimizer و Swarm</span>
        </div>
        <div>
          <strong>حاکمیت و امنیت Fail-Closed</strong>
          <span>ایزولاسیون RLS، سرویس Credential Broker، کانتینر ورکر و سقف بودجه</span>
        </div>
      </section>

      <section className="content-section tutorial-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">مسیر یادگیری گام‌به‌گام</span>
            <h2>در ۶ مرحله از نصب اولیه به اجرای خودکار و سازمانی برسید.</h2>
          </div>
          <Link href="/fa/docs/first-workflow" className="text-link">
            آموزش عملی اولین گراف <ArrowLeft size={15} />
          </Link>
        </div>
        <div className="tutorial-steps tutorial-steps-six">
          {learningSteps.map((step) => (
            <Link className="tutorial-step" href={`/fa/docs/${step.slug}`} key={step.number}>
              <span>{step.number}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </div>
              <ArrowLeft size={16} />
            </Link>
          ))}
        </div>
      </section>

      <section className="content-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">فهرست کامل مستندات و آموزش‌ها</span>
            <h2>تمامی صفحات، قابلیت‌ها و مرزهای عملیاتی پلتفرم در یک نگاه.</h2>
          </div>
          <Link href="/fa/docs/architecture" className="text-link">
            مشاهده‌ی معماری <ArrowLeft size={15} />
          </Link>
        </div>

        <div className="category-stack">
          {faGroups.map((group) => {
            const pages = docPages.filter((page) => faLabels[page.slug]?.group === group);
            return (
              <div key={group} className="category-block">
                <h3 className="category-heading">{group}</h3>
                <div className="doc-grid">
                  {pages.map((page) => {
                    const globalIndex = docPages.findIndex((item) => item.slug === page.slug) + 1;
                    const label = faLabels[page.slug];
                    return (
                      <Link className="doc-card" href={`/fa/docs/${page.slug}`} key={page.slug}>
                        <span className="card-index">
                          {globalIndex < 10 ? `0${globalIndex}` : globalIndex}
                        </span>
                        <div>
                          <h3>{label?.title ?? page.title}</h3>
                          <p>{label?.description ?? page.description}</p>
                        </div>
                        <ArrowLeft size={17} className="card-arrow" />
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
