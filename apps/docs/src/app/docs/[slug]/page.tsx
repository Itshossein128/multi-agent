import Link from "next/link";
import { ArrowLeft, ArrowRight, CheckCircle2, ExternalLink, Info, ShieldCheck } from "lucide-react";
import { docPages, getDoc } from "@/lib/docs";
import { enSections } from "@/lib/enDocs";

export function generateStaticParams() {
  return docPages.map((page) => ({ slug: page.slug }));
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = getDoc(slug);
  const content = enSections[slug];
  if (!page || !content) {
    return (
      <div className="empty-state">
        <h1>Page not found</h1>
        <Link href="/">Return home</Link>
      </div>
    );
  }
  const currentIndex = docPages.findIndex((item) => item.slug === slug);
  const previous = docPages[currentIndex - 1];
  const next = docPages[currentIndex + 1];

  return (
    <article className="doc-page">
      <div className="breadcrumbs">
        <Link href="/">Docs</Link>
        <span>/</span>
        <span>{page.group}</span>
        <span>/</span>
        <strong>{page.title}</strong>
      </div>

      <header className="doc-header">
        <span className="eyebrow">{page.group.toUpperCase()}</span>
        <h1>{content.title}</h1>
        <p>{content.intro}</p>
        <div className="source-line">
          <CheckCircle2 size={15} /> Current source: <code>{page.source}</code>
          <a href={`https://github.com/Itshossein128/multi-agent/blob/main/${page.source}`}>
            <ExternalLink size={13} /> source
          </a>
        </div>
      </header>

      {content.overview && content.overview.length > 0 && (
        <div className="overview-grid" aria-label="Quick reference">
          {content.overview.map((item) => (
            <div key={item.label} className="overview-card">
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      )}

      {content.items.length > 1 && (
        <nav className="toc-box" aria-label="On this page">
          <span className="toc-title">IN THIS TUTORIAL</span>
          <div className="toc-links">
            {content.items.map((item, index) => (
              <a key={item.title} href={`#step-${index + 1}`}>
                {item.title}
              </a>
            ))}
          </div>
        </nav>
      )}

      {slug === "architecture" && <ArchitectureDiagram />}

      {content.code && (
        <pre className="code-block">
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
              <pre className="code-block">
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
          <Link href={`/docs/${previous.slug}`}>
            <ArrowLeft size={15} />
            <span>
              <small>Previous</small>
              {previous.title}
            </span>
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link href={`/docs/${next.slug}`} className="next">
            <span>
              <small>Next</small>
              {next.title}
            </span>
            <ArrowRight size={15} />
          </Link>
        ) : (
          <span />
        )}
      </footer>
    </article>
  );
}

function ArchitectureDiagram() {
  return (
    <div className="architecture-diagram">
      <div className="diagram-row">
        <div className="diagram-node browser">
          <span>01</span>
          <strong>Browser / Next.js</strong>
          <small>Control plane &amp; BFF</small>
        </div>
        <div className="diagram-line" />
        <div className="diagram-node server">
          <span>02</span>
          <strong>Hono execution server</strong>
          <small>Auth · RBAC · compile</small>
        </div>
        <div className="diagram-line" />
        <div className="diagram-node runtime">
          <span>03</span>
          <strong>LangGraph runtime</strong>
          <small>Agents · tools · memory</small>
        </div>
      </div>
      <div className="diagram-branch">
        <div>
          PostgreSQL 16 + pgvector
          <br />
          <small>durable state &amp; RLS</small>
        </div>
        <div>
          Credential Broker
          <br />
          <small>short-lived single-use leases</small>
        </div>
        <div>
          Container worker
          <br />
          <small>isolated CLI execution</small>
        </div>
      </div>
    </div>
  );
}
