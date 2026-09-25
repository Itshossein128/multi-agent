export type DocPage = {
  slug: string;
  title: string;
  description: string;
  group: string;
  source: string;
  status?: "Current" | "Planned" | "Reference";
};

export const docPages: DocPage[] = [
  { slug: "getting-started", title: "Getting started", description: "Run the platform locally and understand the core development loop.", group: "Start here", source: "README.md", status: "Current" },
  { slug: "architecture", title: "Architecture", description: "The control plane, execution server, LangGraph runtime and persistence boundaries.", group: "Understand the platform", source: "docs/architecture.md", status: "Current" },
  { slug: "security", title: "Security model", description: "Trust boundaries, authorization, worker isolation and fail-closed behavior.", group: "Understand the platform", source: "docs/architecture.md", status: "Current" },
  { slug: "memory", title: "Memory", description: "Short-term checkpoints, long-term memory and tenant-aware retrieval.", group: "Capabilities", source: "docs/phase-6-memory.md", status: "Current" },
  { slug: "tools-and-approvals", title: "Tools & approvals", description: "Tool registry, execution policy and human-in-the-loop workflows.", group: "Capabilities", source: "docs/phase-6-tools.md", status: "Current" },
  { slug: "credentials", title: "Credential Broker", description: "Short-lived provider leases, policy enforcement, audit and mTLS boundaries.", group: "Operations", source: "docs/deferred-credential-gateway.md", status: "Current" },
  { slug: "development", title: "Development guide", description: "Environment setup, database migrations and verification commands.", group: "Operations", source: "docs/development.md", status: "Current" },
  { slug: "limitations", title: "Limitations & roadmap", description: "Known gaps, deployment boundaries and the next product milestones.", group: "Operations", source: "docs/implementation-gaps.md", status: "Reference" },
];

export const groups = ["Start here", "Understand the platform", "Capabilities", "Operations"];

export function getDoc(slug: string) {
  return docPages.find((page) => page.slug === slug);
}
