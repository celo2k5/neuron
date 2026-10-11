import { ExperimentDetail } from "@/components/ExperimentDetail";
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `Experiment ${id.slice(0, 8).toUpperCase()}` };
}
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ExperimentDetail id={id} />;
}
