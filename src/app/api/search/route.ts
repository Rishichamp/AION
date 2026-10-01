import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

// Global search across processed content. This queries the database only —
// it never triggers a live internet crawl (see architecture notes in README).
// Matches title, summary/abstract, key contribution, authors, and topic
// names — not just title (see README's search notes for why this still
// isn't full Postgres full-text search, and when that upgrade is worth it).
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q || q.length < 2) return NextResponse.json({ results: [] });

  const user = await getCurrentUser();
  db.searchLog.create({ data: { userId: user.id, query: q } }).catch(() => {});

  const contains = { contains: q, mode: "insensitive" as const };

  const [articles, papers, models, projects] = await Promise.all([
    db.article.findMany({
      where: { OR: [{ title: contains }, { description: contains }, { aiSummary: contains }, { topics: { some: { name: contains } } }] },
      orderBy: [{ importance: "desc" }, { updatedAt: "desc" }, { id: "asc" }],
      take: 10
    }),
    db.researchPaper.findMany({
      where: {
        OR: [
          { title: contains },
          { abstract: contains },
          { aiSummary: contains },
          { keyContribution: contains },
          { authors: { has: q } },
          { topics: { some: { name: contains } } }
        ]
      },
      orderBy: [{ importance: "desc" }, { updatedAt: "desc" }, { id: "asc" }],
      take: 10
    }),
    db.modelRelease.findMany({
      where: { OR: [{ name: contains }, { description: contains }, { organization: contains }] },
      orderBy: [{ importance: "desc" }, { releaseDate: "desc" }, { id: "asc" }],
      take: 10
    }),
    db.openSourceProject.findMany({
      where: { OR: [{ name: contains }, { description: contains }, { organization: contains }] },
      orderBy: [{ importance: "desc" }, { createdAt: "desc" }, { id: "asc" }],
      take: 10
    })
  ]);

  return NextResponse.json({
    results: [
      ...articles.map((a: any) => ({ type: "article", id: a.id, title: a.title, url: a.url })),
      ...papers.map((p: any) => ({ type: "paper", id: p.id, title: p.title, url: p.url })),
      ...models.map((m: any) => ({ type: "model", id: m.id, title: m.name, url: m.announcementUrl })),
      ...projects.map((p: any) => ({ type: "project", id: p.id, title: p.name, url: p.repoUrl }))
    ]
  });
}
