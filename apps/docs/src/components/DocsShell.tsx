"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, GitBranch, Languages, Menu, Moon, Search, Sun, X } from "lucide-react";
import { useEffect, useState } from "react";
import { docPages, groups } from "@/lib/docs";

const faLabels: Record<string, { title: string; group: string }> = {
  "getting-started": { title: "شروع کار", group: "شروع کنید" }, "first-workflow": { title: "اولین Workflow شما", group: "شروع کنید" },
  concepts: { title: "مفاهیم اصلی", group: "مدل سیستم" }, architecture: { title: "معماری", group: "مدل سیستم" }, security: { title: "مدل امنیتی", group: "مدل سیستم" },
  "account-and-workspace": { title: "حساب و Workspace", group: "ساخت با Studio" }, agents: { title: "ساخت Agent", group: "ساخت با Studio" }, workflows: { title: "طراحی Workflow", group: "ساخت با Studio" }, tasks: { title: "مدیریت Taskها", group: "ساخت با Studio" }, "tools-and-approvals": { title: "Toolها و Approvalها", group: "ساخت با Studio" }, memory: { title: "Memory Explorer", group: "ساخت با Studio" },
  runs: { title: "نظارت بر Runها", group: "عملیات Studio" }, persistence: { title: "Persistence و Recovery", group: "عملیات Studio" }, workers: { title: "CLI Workerها", group: "عملیات Studio" }, credentials: { title: "Credential Broker", group: "عملیات Studio" },
  development: { title: "راهنمای توسعه", group: "مرجع" }, deployment: { title: "چک‌لیست Deployment", group: "مرجع" }, troubleshooting: { title: "عیب‌یابی", group: "مرجع" }, limitations: { title: "محدودیت‌ها و Roadmap", group: "مرجع" },
};
const faGroups = ["شروع کنید", "مدل سیستم", "ساخت با Studio", "عملیات Studio", "مرجع"];

export function DocsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isFa = pathname.startsWith("/fa");
  const localePath = isFa ? pathname.replace(/^\/fa/, "") || "/" : `/fa${pathname === "/" ? "" : pathname}`;
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
    <div className="site-shell" dir={isFa ? "rtl" : "ltr"}>
      <header className="topbar">
        <Link href="/" className="brand" aria-label="Multi-Agent Studio documentation home">
          <span className="brand-mark"><BookOpen size={17} /></span>
          <span>Multi-Agent <em>Studio</em></span>
        </Link>
        <div className="topbar-actions">
          <a href="https://github.com/Itshossein128/multi-agent" className="top-link"><GitBranch size={15} /> {isFa ? "مخزن کد" : "Repository"}</a>
          <Link href={localePath} className="top-link language-switch"><Languages size={15} /> {isFa ? "English" : "فارسی"}</Link>
          <button className="icon-button" onClick={toggleTheme} aria-label="Toggle theme">{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
          <button className="icon-button mobile-menu" onClick={() => setOpen(!open)} aria-label="Toggle navigation">{open ? <X size={19} /> : <Menu size={19} />}</button>
        </div>
      </header>
      <div className="layout">
        <aside className={`sidebar ${open ? "is-open" : ""}`}>
          <div className="sidebar-intro"><span className="eyebrow">{isFa ? "مستندات" : "DOCUMENTATION"}</span><p>{isFa ? "Workflowهای agentic را با درک روشن و کنترل‌پذیر بسازید و اجرا کنید." : "Build, secure and operate agentic workflows with confidence."}</p></div>
          <label className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} onInput={(event) => setQuery(event.currentTarget.value)} placeholder="Search docs" aria-label="Search documentation" /><kbd>⌘ K</kbd></label>
          {results.length > 0 && <div className="search-results">{results.map((result) => <Link key={result.slug} href={`/docs/${result.slug}`} onClick={() => setOpen(false)}><strong>{result.title}</strong><span>{result.description}</span></Link>)}</div>}
          <nav aria-label={isFa ? "ناوبری مستندات" : "Documentation navigation"}>
            {(isFa ? faGroups : groups).map((group) => <div className="nav-group" key={group}><span className="nav-label">{group}</span>{docPages.filter((page) => (isFa ? faLabels[page.slug]?.group : page.group) === group).map((page) => <Link key={page.slug} href={`${isFa ? "/fa" : ""}/docs/${page.slug}`} className={pathname === `${isFa ? "/fa" : ""}/docs/${page.slug}` ? "active" : ""} onClick={() => setOpen(false)}>{isFa ? faLabels[page.slug].title : page.title}{page.status === "Reference" && <small>{isFa ? "مرجع" : "ref"}</small>}</Link>)}</div>)}
          </nav>
          <div className="sidebar-footer"><Languages size={15} /><span>{isFa ? "فارسی" : "English"}</span><span className="footer-dot">•</span><span>{isFa ? "English" : "فارسی"}</span></div>
        </aside>
        <main id="main-content" className="main-content">{children}</main>
      </div>
    </div>
  );
}
