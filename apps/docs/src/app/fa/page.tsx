import Link from "next/link";
import { ArrowLeft, CheckCircle2, LockKeyhole, Network, Terminal } from "lucide-react";

const cards = [
  ["getting-started", "شروع کار", "نصب، اجرای محیط محلی و ساخت حساب."],
  ["first-workflow", "اولین Workflow", "از Agent تا Task و نتیجه‌ی نهایی."],
  ["concepts", "مفاهیم اصلی", "رابطه‌ی Organization، Agent، Workflow و Run."],
  ["agents", "ساخت Agent", "تنظیم backend و استفاده‌ی مجدد از Agent."],
  ["workflows", "طراحی Workflow", "ساخت graph، شرط‌ها و approvalها."],
  ["runs", "نظارت بر Runها", "خواندن timeline و عیب‌یابی اجرا."],
];

export default function PersianHomePage() {
  return <>
    <section className="hero">
      <div className="hero-copy"><span className="status-pill"><span className="pulse" /> مستندات فارسی · نسخه‌ی جاری</span><h1>Workflowهای agentic را<br /><span>با اطمینان بسازید.</span></h1><p>راهنمای کامل Multi-Agent Studio برای نصب، ساخت Agent و Workflow، اجرای Task، مشاهده‌ی نتیجه و آماده‌سازی deployment.</p><div className="hero-actions"><Link className="button primary" href="/fa/docs/getting-started">شروع آموزش <ArrowLeft size={16} /></Link><Link className="button secondary" href="/fa/docs/architecture">مشاهده‌ی معماری</Link></div></div>
      <div className="hero-visual" aria-label="پیش‌نمایش معماری پلتفرم"><div className="visual-grid" /><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="core-node"><Network size={26} /><span>AgentRuntime</span></div><div className="floating-node node-a"><Terminal size={16} /><span>Workflow</span></div><div className="floating-node node-b"><LockKeyhole size={16} /><span>Policy</span></div><div className="floating-node node-c"><CheckCircle2 size={16} /><span>RunStore</span></div></div>
    </section>
    <section className="signal-row"><div><strong>Self-hosted</strong><span>زیرساخت و داده در اختیار شما</span></div><div><strong>قراردادهای Typed</strong><span>Nodeها و نتیجه‌های قابل پیش‌بینی</span></div><div><strong>Fail-closed</strong><span>امنیت در تمام مرزها</span></div></section>
    <section className="content-section"><div className="section-heading"><div><span className="eyebrow">نقشه‌ی مستندات</span><h2>مسیر خود را در پلتفرم پیدا کنید.</h2></div><Link href="/fa/docs/concepts" className="text-link">مفاهیم اصلی <ArrowLeft size={15} /></Link></div><div className="doc-grid">{cards.map(([slug, title, description], index) => <Link className="doc-card" href={`/fa/docs/${slug}`} key={slug}><span className="card-index">0{index + 1}</span><div><h3>{title}</h3><p>{description}</p></div><ArrowLeft size={17} className="card-arrow" /></Link>)}</div></section>
    <section className="content-section tutorial-section"><div className="section-heading"><div><span className="eyebrow">مسیر یادگیری</span><h2>از نصب تا یک Run قابل اعتماد.</h2></div></div><div className="tutorial-steps">{[["۰۱", "نصب", "محیط محلی را اجرا و حساب بسازید.", "getting-started"], ["۰۲", "ساخت", "Agent و graph خود را بسازید.", "first-workflow"], ["۰۳", "اجرا", "Task را اجرا و timeline را بخوانید.", "runs"], ["۰۴", "سخت‌سازی", "امنیت، recovery و deployment را بررسی کنید.", "deployment"]].map(([number, title, text, slug]) => <Link className="tutorial-step" href={`/fa/docs/${slug}`} key={number}><span>{number}</span><div><h3>{title}</h3><p>{text}</p></div><ArrowLeft size={16} /></Link>)}</div></section>
  </>;
}
