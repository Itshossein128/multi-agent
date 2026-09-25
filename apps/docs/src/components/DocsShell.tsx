"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, GitBranch, Languages, Menu, Moon, Search, Sun, X } from "lucide-react";
import { useEffect, useState } from "react";
import { docPages, groups } from "@/lib/docs";

export function DocsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(() => typeof window !== "undefined" && window.localStorage.getItem("docs-theme") === "dark");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const saved = window.localStorage.getItem("docs-theme");
    document.documentElement.dataset.theme = saved === "dark" ? "dark" : "light";
  }, []);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    window.localStorage.setItem("docs-theme", next ? "dark" : "light");
  }

  const results = query.trim() ? docPages.filter((page) => `${page.title} ${page.description}`.toLowerCase().includes(query.toLowerCase())) : [];

  return (
    <div className="site-shell">
      <header className="topbar">
        <Link href="/" className="brand" aria-label="Multi-Agent Studio documentation home">
          <span className="brand-mark"><BookOpen size={17} /></span>
          <span>Multi-Agent <em>Studio</em></span>
        </Link>
        <div className="topbar-actions">
          <a href="https://github.com/Itshossein128/multi-agent" className="top-link"><GitBranch size={15} /> Repository</a>
          <button className="icon-button" onClick={toggleTheme} aria-label="Toggle theme">{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
          <button className="icon-button mobile-menu" onClick={() => setOpen(!open)} aria-label="Toggle navigation">{open ? <X size={19} /> : <Menu size={19} />}</button>
        </div>
      </header>
      <div className="layout">
        <aside className={`sidebar ${open ? "is-open" : ""}`}>
          <div className="sidebar-intro"><span className="eyebrow">DOCUMENTATION</span><p>Build, secure and operate agentic workflows with confidence.</p></div>
          <label className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} onInput={(event) => setQuery(event.currentTarget.value)} placeholder="Search docs" aria-label="Search documentation" /><kbd>⌘ K</kbd></label>
          {results.length > 0 && <div className="search-results">{results.map((result) => <Link key={result.slug} href={`/docs/${result.slug}`} onClick={() => setOpen(false)}><strong>{result.title}</strong><span>{result.description}</span></Link>)}</div>}
          <nav aria-label="Documentation navigation">
            {groups.map((group) => <div className="nav-group" key={group}><span className="nav-label">{group}</span>{docPages.filter((page) => page.group === group).map((page) => <Link key={page.slug} href={`/docs/${page.slug}`} className={pathname === `/docs/${page.slug}` ? "active" : ""} onClick={() => setOpen(false)}>{page.title}{page.status === "Reference" && <small>ref</small>}</Link>)}</div>)}
          </nav>
          <div className="sidebar-footer"><Languages size={15} /><span>English</span><span className="footer-dot">•</span><span>فارسی soon</span></div>
        </aside>
        <main id="main-content" className="main-content">{children}</main>
      </div>
    </div>
  );
}
