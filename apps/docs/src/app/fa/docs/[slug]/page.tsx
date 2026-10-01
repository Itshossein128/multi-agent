import Link from "next/link";
import { ArrowLeft, ArrowRight, CheckCircle2, ExternalLink, ShieldCheck } from "lucide-react";
import { docPages } from "@/lib/docs";
import { faSections } from "@/lib/faDocs";

export function generateStaticParams() { return docPages.map((page) => ({ slug: page.slug })); }

export default async function PersianDocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = docPages.find((item) => item.slug === slug);
  const content = faSections[slug];
  if (!page || !content) return <div className="empty-state"><h1>صفحه پیدا نشد</h1><Link href="/fa">بازگشت به خانه</Link></div>;
  const currentIndex = docPages.findIndex((item) => item.slug === slug);
  const previous = docPages[currentIndex - 1];
  const next = docPages[currentIndex + 1];
  return <article className="doc-page"><div className="breadcrumbs"><Link href="/fa">مستندات</Link><span>/</span><span>{content.title}</span></div><header className="doc-header"><span className="eyebrow">راهنمای آموزشی</span><h1>{content.title}</h1><p>{content.intro}</p><div className="source-line"><CheckCircle2 size={15} /> منبع جاری: <code>{page.source}</code><a href={`https://github.com/Itshossein128/multi-agent/blob/main/${page.source}`}><ExternalLink size={13} /> کد</a></div></header>{slug === "architecture" && <PersianArchitectureDiagram />}{content.code && <pre className="code-block"><code>{content.code}</code></pre>}<div className="prose-grid">{content.items.map((item) => <section key={item.title}><h2>{item.title}</h2><p>{item.body}</p></section>)}</div>{slug === "security" && <div className="callout"><ShieldCheck size={20} /><div><strong>اصل امنیتی</strong><p>هر boundary باید owner مشخص، تصمیم authorization صریح و failure امن داشته باشد.</p></div></div>}<footer className="doc-footer">{previous ? <Link href={`/fa/docs/${previous.slug}`}><ArrowRight size={15} /><span><small>قبلی</small>{faSections[previous.slug]?.title}</span></Link> : <span />}{next ? <Link href={`/fa/docs/${next.slug}`} className="next"><span><small>بعدی</small>{faSections[next.slug]?.title}</span><ArrowLeft size={15} /></Link> : <span />}</footer></article>;
}

function PersianArchitectureDiagram() { return <div className="architecture-diagram"><div className="diagram-row"><div className="diagram-node browser"><span>۰۱</span><strong>Browser / Next.js</strong><small>Control plane</small></div><div className="diagram-line" /><div className="diagram-node server"><span>۰۲</span><strong>Hono execution server</strong><small>Auth · policy · compile</small></div><div className="diagram-line" /><div className="diagram-node runtime"><span>۰۳</span><strong>LangGraph runtime</strong><small>Agents · tools · memory</small></div></div><div className="diagram-branch"><div>PostgreSQL<br /><small>داده‌ی پایدار</small></div><div>Credential Broker<br /><small>lease کوتاه‌عمر</small></div><div>Container worker<br /><small>اجرای ایزوله</small></div></div></div>; }
