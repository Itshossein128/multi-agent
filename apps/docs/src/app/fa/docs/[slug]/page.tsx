import Link from "next/link";
import { ArrowLeft, ArrowRight, CheckCircle2, ExternalLink, Info, ShieldCheck } from "lucide-react";
import { docPages } from "@/lib/docs";
import { faLabels, faSections } from "@/lib/faDocs";

export function generateStaticParams() {
  return docPages.map((page) => ({ slug: page.slug }));
}

export default async function PersianDocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = docPages.find((item) => item.slug === slug);
  const content = faSections[slug];
  if (!page || !content) {
    return (
      <div className="empty-state">
        <h1>صفحه پیدا نشد</h1>
        <Link href="/fa">بازگشت به خانه</Link>
      </div>
    );
  }
  const currentIndex = docPages.findIndex((item) => item.slug === slug);
  const previous = docPages[currentIndex - 1];
  const next = docPages[currentIndex + 1];

  return (
    <article className="doc-page">
      <div className="breadcrumbs">
        <Link href="/fa">مستندات</Link>
        <span>/</span>
        <span>{faLabels[slug]?.group ?? page.group}</span>
        <span>/</span>
        <strong>{content.title}</strong>
      </div>

      <header className="doc-header">
        <span className="eyebrow">{faLabels[slug]?.group ?? "راهنمای آموزشی"}</span>
        <h1>{content.title}</h1>
        <p>{content.intro}</p>
        <div className="source-line">
          <CheckCircle2 size={15} /> منبع جاری: <code dir="ltr">{page.source}</code>
          <a href={`https://github.com/Itshossein128/multi-agent/blob/main/${page.source}`}>
            <ExternalLink size={13} /> کد
          </a>
        </div>
      </header>

      {content.overview && content.overview.length > 0 && (
        <div className="overview-grid" aria-label="مرجع سریع">
          {content.overview.map((item) => (
            <div key={item.label} className="overview-card">
              <span>{item.label}</span>
              <strong dir="ltr">{item.value}</strong>
            </div>
          ))}
        </div>
      )}

      {content.items.length > 1 && (
        <nav className="toc-box" aria-label="در این صفحه">
          <span className="toc-title">سرفصل‌های این آموزش</span>
          <div className="toc-links">
            {content.items.map((item, index) => (
              <a key={item.title} href={`#step-${index + 1}`}>
                {item.title}
              </a>
            ))}
          </div>
        </nav>
      )}

      {slug === "architecture" && <PersianArchitectureDiagram />}

      {content.code && (
        <pre className="code-block" dir="ltr">
          <code>{content.code}</code>
        </pre>
      )}

      <div className="prose-grid">
        {content.items.map((item, index) => (
          <section key={item.title} id={`step-${index + 1}`}>
            <h2>{item.title}</h2>
            <p>{item.body}</p>
            {item.bullets && item.bullets.length > 0 && (
              <ul className="prose-bullets">
                {item.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            )}
            {item.code && (
              <pre className="code-block" dir="ltr">
                <code>{item.code}</code>
              </pre>
            )}
            {item.note && (
              <div className="section-note">
                <Info size={16} />
                <p>{item.note}</p>
              </div>
            )}
          </section>
        ))}
      </div>

      {content.callout && (
        <div className="callout">
          <ShieldCheck size={20} />
          <div>
            <strong>{content.callout.title}</strong>
            <p>{content.callout.body}</p>
          </div>
        </div>
      )}

      <footer className="doc-footer">
        {previous ? (
          <Link href={`/fa/docs/${previous.slug}`}>
            <ArrowRight size={15} />
            <span>
              <small>قبلی</small>
              {faLabels[previous.slug]?.title ?? faSections[previous.slug]?.title}
            </span>
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link href={`/fa/docs/${next.slug}`} className="next">
            <span>
              <small>بعدی</small>
              {faLabels[next.slug]?.title ?? faSections[next.slug]?.title}
            </span>
            <ArrowLeft size={15} />
          </Link>
        ) : (
          <span />
        )}
      </footer>
    </article>
  );
}

function PersianArchitectureDiagram() {
  return (
    <div className="architecture-diagram">
      <div className="diagram-row">
        <div className="diagram-node browser">
          <span>۰۱</span>
          <strong>Browser / Next.js</strong>
          <small>Control plane &amp; BFF</small>
        </div>
        <div className="diagram-line" />
        <div className="diagram-node server">
          <span>۰۲</span>
          <strong>Hono execution server</strong>
          <small>Auth · RBAC · compile</small>
        </div>
        <div className="diagram-line" />
        <div className="diagram-node runtime">
          <span>۰۳</span>
          <strong>LangGraph runtime</strong>
          <small>Agents · tools · memory</small>
        </div>
      </div>
      <div className="diagram-branch">
        <div>
          PostgreSQL 16 + pgvector
          <br />
          <small>داده‌ی پایدار و RLS</small>
        </div>
        <div>
          Credential Broker
          <br />
          <small>Leaseهای تک‌مصرف کوتاه‌عمر</small>
        </div>
        <div>
          Container worker
          <br />
          <small>اجرای ایزوله‌ی CLI</small>
        </div>
      </div>
    </div>
  );
}
