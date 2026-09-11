import { ToolDetail } from "@/components/tools/ToolDetail";

export default async function ToolDetailPage({ params }: { params: Promise<{ toolId: string }> }) {
  const { toolId } = await params;
  return <ToolDetail key={toolId} toolId={toolId} />;
}
