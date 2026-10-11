import { AgentDetail } from "@/components/agents/AgentDetail";

export default async function AgentDetailPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  return <AgentDetail key={agentId} agentId={agentId} />;
}
