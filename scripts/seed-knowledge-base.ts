/**
 * Seed the knowledge_patterns table from curated JSON files.
 *
 * Usage: pnpm run seed
 * Requires: DATABASE_URL, VOYAGE_API_KEY environment variables
 *
 * Idempotent — deletes all existing patterns before seeding.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { embedTexts, getDb, knowledgePatterns, sql } from "../packages/db/src/index";
import { KnowledgePatternSchema } from "../packages/shared/src/schemas/knowledge";

interface PatternEntry {
  id: string;
  clausePattern: string;
  category: string;
  contractType: string[];
  riskLevel: "red" | "yellow";
  whyRisky: string;
  saferAlternative: string;
  jurisdictionNotes: string;
}

const DATA_DIR = join(import.meta.dirname, "..", "data", "knowledge-base");
const EMBED_BATCH_SIZE = 128; // Voyage API max per call

function loadPatterns(): PatternEntry[] {
  const files = readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));
  const patterns: PatternEntry[] = [];
  let validationErrors = 0;

  for (const file of files) {
    const filePath = join(DATA_DIR, file);
    const raw = JSON.parse(readFileSync(filePath, "utf-8")) as unknown[];

    for (let i = 0; i < raw.length; i++) {
      const result = KnowledgePatternSchema.safeParse(raw[i]);
      if (!result.success) {
        console.error(
          `Validation error in ${file}[${i}]:`,
          result.error.issues.map((iss) => `${iss.path.join(".")}: ${iss.message}`).join(", "),
        );
        validationErrors++;
      } else {
        patterns.push(result.data as PatternEntry);
      }
    }

    console.log(`  Loaded ${file}: ${raw.length} entries`);
  }

  if (validationErrors > 0) {
    throw new Error(`${validationErrors} validation errors found. Fix them before seeding.`);
  }

  return patterns;
}

async function seed() {
  console.log("Loading knowledge base patterns...");
  const patterns = loadPatterns();
  console.log(`Seeding ${patterns.length} patterns...\n`);

  const db = getDb();

  // Idempotent: clear existing patterns
  console.log("Clearing existing knowledge patterns...");
  await db.delete(knowledgePatterns);

  // Batch embed all clause patterns
  const allTexts = patterns.map((p) => p.clausePattern);
  const allEmbeddings: number[][] = [];
  const totalBatches = Math.ceil(allTexts.length / EMBED_BATCH_SIZE);

  for (let i = 0; i < allTexts.length; i += EMBED_BATCH_SIZE) {
    const batchNum = Math.floor(i / EMBED_BATCH_SIZE) + 1;
    const batch = allTexts.slice(i, i + EMBED_BATCH_SIZE);
    console.log(`Embedding batch ${batchNum}/${totalBatches} (${batch.length} texts)...`);
    const embeddings = await embedTexts(batch, "document");
    allEmbeddings.push(...embeddings);
  }

  // Insert all patterns with embeddings
  console.log("\nInserting patterns into database...");
  const rows = patterns.map((pattern, i) => ({
    id: pattern.id,
    clausePattern: pattern.clausePattern,
    category: pattern.category,
    contractType: pattern.contractType,
    riskLevel: pattern.riskLevel,
    whyRisky: pattern.whyRisky,
    saferAlternative: pattern.saferAlternative,
    jurisdictionNotes: pattern.jurisdictionNotes,
    embedding: allEmbeddings[i] ?? [],
  }));

  // Insert in batches of 50 to avoid overly large queries
  const insertBatchSize = 50;
  for (let i = 0; i < rows.length; i += insertBatchSize) {
    const batch = rows.slice(i, i + insertBatchSize);
    await db.insert(knowledgePatterns).values(
      batch.map((row) => ({
        ...row,
        embedding: sql`${JSON.stringify(row.embedding)}::vector`,
      })),
    );
  }

  console.log(`\nDone. Seeded ${patterns.length} knowledge patterns.`);
  process.exit(0);
}

seed().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
