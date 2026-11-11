"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, GitBranch, Languages, Menu, Moon, Search, Sun, X } from "lucide-react";
import { useEffect, useState } from "react";
import { docPages, groups } from "@/lib/docs";
import { enSections } from "@/lib/enDocs";
import { faGroups, faLabels, faSections } from "@/lib/faDocs";

export function DocsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isFa = pathname.startsWith("/fa");
  const localePath = isFa
    ? pathname.replace(/^\/fa/, "") || "/"
    : `/fa${pathname === "/" ? "" : pathname}`;
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(
    () => typeof window !== "undefined" && window.localStorage.getItem("docs-theme") === "dark",
  );
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

  const normalizedQuery = query.trim().toLowerCase();
  const results = normalizedQuery
    ? docPages.filter((page) => {
        const faMeta = faLabels[page.slug];
        const enSection = enSections[page.slug];
        const faSection = faSections[page.slug];
        const haystack = [
          page.title,
          page.description,
          faMeta?.title ?? "",
          faMeta?.description ?? "",
          enSection?.intro ?? "",
          ...(enSection?.items.map((item) => `${item.title} ${item.body}`) ?? []),
          faSection?.intro ?? "",
          ...(faSection?.items.map((item) => `${item.title} ${item.body}`) ?? []),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(normalizedQuery);
      })
    : [];

  return (
    <div className="site-shell" dir={isFa ? "rtl" : "ltr"}>
      <header className="topbar">
        <Link
          href={isFa ? "/fa" : "/"}
          className="brand"
          aria-label="Multi-Agent Studio documentation home"
        >
          <span className="brand-mark">
            <BookOpen size={17} />
          </span>
          <span>
            Multi-Agent <em>Studio</em>
          </span>
        </Link>
        <div className="topbar-actions">
          <a href="https://github.com/Itshossein128/multi-agent" className="top-link">
            <GitBranch size={15} /> {isFa ? "مخزن کد" : "Repository"}
          </a>
          <Link href={localePath} className="top-link language-switch">
            <Languages size={15} /> {isFa ? "English" : "فارسی"}
          </Link>
          <button className="icon-button" onClick={toggleTheme} aria-label="Toggle theme">
            {dark ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <button
            className="icon-button mobile-menu"
            onClick={() => setOpen(!open)}
            aria-label="Toggle navigation"
          >
            {open ? <X size={19} /> : <Menu size={19} />}
          </button>
        </div>
      </header>
      <div className="layout">
        <aside className={`sidebar ${open ? "is-open" : ""}`}>
          <div className="sidebar-intro">
            <span className="eyebrow">{isFa ? "مستندات و آموزش کامل" : "USER GUIDE & TUTORIALS"}</span>
            <p>
              {isFa
                ? "آموزش صفر تا صد کار با Multi-Agent Studio: از نصب تا طراحی گراف، مدیریت Task و عملیات."
                : "Complete step-by-step tutorials to build, govern and operate agentic workflows in Studio."}
            </p>
          </div>
          <label className="search-box">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onInput={(event) => setQuery(event.currentTarget.value)}
              placeholder={isFa ? "جست‌وجو در آموزش‌ها..." : "Search tutorials & docs"}
              aria-label="Search documentation"
            />
            <kbd>⌘ K</kbd>
          </label>
          {results.length > 0 && (
            <div className="search-results">
              {results.map((result) => (
                <Link
                  key={result.slug}
                  href={`${isFa ? "/fa" : ""}/docs/${result.slug}`}
                  onClick={() => {
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <strong>{isFa ? faLabels[result.slug]?.title ?? result.title : result.title}</strong>
                  <span>
                    {isFa
                      ? faLabels[result.slug]?.description ?? result.description
                      : result.description}
                  </span>
                </Link>
              ))}
            </div>
          )}
          <nav aria-label={isFa ? "ناوبری مستندات" : "Documentation navigation"}>
            {(isFa ? faGroups : groups).map((group) => (
              <div className="nav-group" key={group}>
                <span className="nav-label">{group}</span>
                {docPages
                  .filter((page) => (isFa ? faLabels[page.slug]?.group : page.group) === group)
                  .map((page) => {
                    const href = `${isFa ? "/fa" : ""}/docs/${page.slug}`;
                    return (
                      <Link
                        key={page.slug}
                        href={href}
                        className={pathname === href ? "active" : ""}
                        onClick={() => setOpen(false)}
                      >
                        {isFa ? faLabels[page.slug]?.title ?? page.title : page.title}
                        {page.status === "Reference" && <small>{isFa ? "مرجع" : "ref"}</small>}
                      </Link>
                    );
                  })}
              </div>
            ))}
          </nav>
          <div className="sidebar-footer">
            <Languages size={15} />
            <span>{isFa ? "فارسی" : "English"}</span>
            <span className="footer-dot">•</span>
            <span>{isFa ? "English" : "فارسی"}</span>
          </div>
        </aside>
        <main id="main-content" className="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
