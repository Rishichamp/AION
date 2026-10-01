import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { RadarRunner } from "@/components/RadarRunner";

export default async function RadarPage() {
  const user = await getCurrentUser();
  const latest = await db.radarBrief.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: { items: { include: { article: true, paper: true, model: true, project: true } } }
  });

  return (
    <div className="px-5 py-8 md:px-10 md:py-12">
      <RadarRunner initialBrief={latest as any} />
    </div>
  );
}
