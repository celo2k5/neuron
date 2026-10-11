import { ExperimentDetail } from "@/components/ExperimentDetail";
export const metadata = { title: "Experiment" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ExperimentDetail id={id} />;
}
