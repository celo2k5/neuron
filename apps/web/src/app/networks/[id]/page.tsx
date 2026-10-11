import { ModelDetail } from "@/components/ModelDetail";
export const metadata = { title: "Network" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ModelDetail id={id} />;
}
