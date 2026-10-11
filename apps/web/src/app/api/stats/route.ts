import { handler } from "@/lib/server/http";
import { one } from "@/lib/server/db";
export const dynamic = "force-dynamic";
export const GET = handler(async () => one(`select
  (select count(*)::int from models where visibility = 'public') as models,
  (select count(*)::int from model_versions where trained) as trained_versions,
  (select count(*)::int from experiments where status = 'completed') as experiments,
  (select count(*)::int from commitments where status = 'verified') as verified,
  (select count(*)::int from neurons where status = 'active' and owner_id is not null) as community_neurons,
  (select coalesce(max(current_version),0)::int from networks) as network_version`));
