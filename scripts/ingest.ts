import { runIngestion } from "../src/lib/ingestion/pipeline";
import { aiBudgetStatus } from "../src/lib/ai/client";
import { connectorsForCategory, type SourceConnector } from "../src/lib/sources";

const CATEGORIES: SourceConnector["category"][] = ["research", "news", "models", "opensource"];

async function main() {
  const arg = process.argv.find((a) => a.startsWith("--source="));
  const requested = arg?.split("=")[1] as SourceConnector["category"] | undefined;

  const categories = requested ? [requested] : CATEGORIES;
  if (requested && !CATEGORIES.includes(requested)) {
    console.error(`Unknown --source="${requested}". Use one of: ${CATEGORIES.join(", ")}`);
    process.exit(1);
  }

  console.log(aiBudgetStatus());
  for (const category of categories) {
    console.log(`\n=== Ingesting: ${category} ===`);
    const results = await runIngestion(connectorsForCategory(category));
    for (const r of results) {
      const status = r.error ? `FAILED (${r.error})` : `${r.stored} stored, ${r.skipped} skipped of ${r.found} found`;
      console.log(`  ${r.source}: ${status}`);
    }
  }
  console.log(`\n${aiBudgetStatus()}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Ingestion run crashed:", err);
    process.exit(1);
  });
