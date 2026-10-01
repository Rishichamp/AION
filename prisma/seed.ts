import { PrismaClient } from "@prisma/client";
import { ALL_CONNECTORS } from "../src/lib/sources";
import { KNOWN_TOPICS } from "../src/lib/ingestion/classify";

const db = new PrismaClient();

const KIND_MAP: Record<string, string> = {
  arXiv: "ARXIV",
  OpenAlex: "OPENALEX",
  GitHub: "GITHUB",
  "Hugging Face Models": "HUGGINGFACE"
};

async function main() {
  for (const connector of ALL_CONNECTORS) {
    await db.source.upsert({
      where: { name: connector.name },
      update: {},
      create: {
        name: connector.name,
        kind: (KIND_MAP[connector.name] ?? "RSS_NEWS") as any,
        endpoint: connector.name,
        category: connector.category
      }
    });
  }
  console.log(`Seeded ${ALL_CONNECTORS.length} sources.`);

  for (const name of KNOWN_TOPICS) {
    const slug = name.toLowerCase().replace(/\s+/g, "-");
    await db.topic.upsert({ where: { slug }, update: {}, create: { slug, name } });
  }
  console.log(`Seeded ${KNOWN_TOPICS.length} topics.`);

  const demo = await db.user.upsert({
    where: { email: "demo@aion.local" },
    update: {},
    create: { email: "demo@aion.local", isDemo: true, notifPrefs: { create: {} } }
  });

  const starterInterests = ["LLMs", "AI Agents", "Reasoning", "AI Safety", "Open Source AI"];
  for (const topic of starterInterests) {
    await db.userInterest.upsert({
      where: { userId_topic: { userId: demo.id, topic } },
      update: {},
      create: { userId: demo.id, topic, weight: 1 }
    });
  }
  console.log("Seeded demo user with starter interests.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
