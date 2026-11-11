import Link from "next/link";
import { ArrowRight, CheckCircle2, LockKeyhole, Network, Terminal } from "lucide-react";
import { docPages, groups } from "@/lib/docs";

const learningSteps = [
  {
    number: "01",
    title: "Install & onboard",
    text: "Start PostgreSQL, run migrations, launch Studio, register your account and create an organization.",
    slug: "getting-started",
  },
  {
    number: "02",
    title: "Projects & workspaces",
    text: "Create a project, attach Git repositories and configure isolated branch workspaces.",
    slug: "projects-and-workspaces",
  },
  {
    number: "03",
    title: "Agents & tools",
    text: "Register API, CLI or local agents, set execution policies, enable heartbeats and test live.",
    slug: "agents",
  },
  {
    number: "04",
    title: "Visual workflows",
    text: "Connect all 10 node types across Linear, Supervisor, Evaluator-Optimizer or Swarm archetypes.",
    slug: "workflows",
  },
  {
    number: "05",
    title: "Tasks, approvals & runs",
    text: "Dispatch work on the Kanban board, approve human gates and inspect live SSE run timelines.",
    slug: "tasks",
  },
  {
    number: "06",
    title: "Automate & govern",
    text: "Delegate company goals, schedule cron routines, wire HMAC webhooks and enforce USD cost budgets.",
    slug: "goals-and-delegation",
  },
];

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <span className="status-pill">
            <span className="pulse" /> Complete User Tutorial · 24 Guides
          </span>
          <h1>
            Master Multi-Agent Studio
            <br />
            <span>from first install to production.</span>
          </h1>
          <p>
            The complete, step-by-step user manual and tutorial for building, governing and operating
            multi-agent software workflows — covering organizations, projects, workspaces, agents,
            visual graphs, tasks, approvals, memory, goals, routines, webhooks and budgets.
          </p>
          <div className="hero-actions">
            <Link className="button primary" href="/docs/getting-started">
              Start the tutorial <ArrowRight size={16} />
            </Link>
            <Link className="button secondary" href="/docs/first-workflow">
              10-minute first workflow
            </Link>
          </div>
        </div>
        <div className="hero-visual" aria-label="Platform architecture preview">
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
          <strong>Studio Web (:3060) &amp; Server (:4000)</strong>
          <span>Authenticated Next.js control plane + Hono LangGraph runtime</span>
        </div>
        <div>
          <strong>4 Workflow Archetypes &amp; 10 Node Types</strong>
          <span>Linear DAG, Hierarchical Supervisor, Evaluator-Optimizer &amp; Swarm</span>
        </div>
        <div>
          <strong>Fail-Closed Governance</strong>
          <span>PostgreSQL RLS, Credential Broker leases, container workers &amp; USD budgets</span>
        </div>
      </section>

      <section className="content-section tutorial-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">STEP-BY-STEP LEARNING PATH</span>
            <h2>Follow the 6-stage curriculum from zero to autonomous operations.</h2>
          </div>
          <Link href="/docs/first-workflow" className="text-link">
            Hands-on walkthrough <ArrowRight size={15} />
          </Link>
        </div>
        <div className="tutorial-steps tutorial-steps-six">
          {learningSteps.map((step) => (
            <Link className="tutorial-step" href={`/docs/${step.slug}`} key={step.number}>
              <span>{step.number}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </div>
              <ArrowRight size={16} />
            </Link>
          ))}
        </div>
      </section>

      <section className="content-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">COMPLETE DOCUMENTATION DIRECTORY</span>
            <h2>Every feature, screen and operational boundary explained.</h2>
          </div>
          <Link href="/docs/architecture" className="text-link">
            View architecture <ArrowRight size={15} />
          </Link>
        </div>

        <div className="category-stack">
          {groups.map((group) => {
            const pages = docPages.filter((page) => page.group === group);
            return (
              <div key={group} className="category-block">
                <h3 className="category-heading">{group}</h3>
                <div className="doc-grid">
                  {pages.map((page) => {
                    const globalIndex = docPages.findIndex((item) => item.slug === page.slug) + 1;
                    return (
                      <Link className="doc-card" href={`/docs/${page.slug}`} key={page.slug}>
                        <span className="card-index">
                          {globalIndex < 10 ? `0${globalIndex}` : globalIndex}
                        </span>
                        <div>
                          <h3>{page.title}</h3>
                          <p>{page.description}</p>
                        </div>
                        <ArrowRight size={17} className="card-arrow" />
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
