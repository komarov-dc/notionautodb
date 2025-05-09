import { QdrantClient } from "@qdrant/js-client-rest";
import { improveUserQuery, generateFinalAnswer, getEmbedding } from '../ollama-llm'; // Adjusted path

// Configuration (should match your main setup)
const QDRANT_URL = "http://localhost:6333";
const COLLECTION = "lpm_partners_demo";
const EMBED_MODEL = "mxbai-embed-large"; // Ensure this matches the model used for ingestion

const qdrant = new QdrantClient({ url: QDRANT_URL });

async function searchQdrantSimilar(embedding: number[], topK = 3) {
  const result = await qdrant.search(COLLECTION, {
    vector: {
      name: "text",
      vector: embedding
    },
    limit: topK,
    with_payload: true,
  });
  return result.map((r: any) => r.payload.chunk || JSON.stringify(r.payload));
}

async function testQueryPipeline(userQuery: string) {
  console.log(`\n--- Testing Query: \"${userQuery}\" ---`);

  try {
    // 1. Улучшаем запрос через Ollama
    const improvedQuery = await improveUserQuery(userQuery);
    console.log(`[OLLAMA] Improved Query: ${improvedQuery}`);

    // 2. Получаем embedding
    const embedding = await getEmbedding(improvedQuery);
    console.log(`[EMBEDDING] Vector received, length: ${embedding.length}`);

    // 3. Ищем в Qdrant
    const chunks = await searchQdrantSimilar(embedding, 3);
    console.log(`[QDRANT] Found chunks: ${chunks.length}`);
    if (chunks.length > 0) {
      chunks.forEach((chunk, index) => {
        console.log(`--- Chunk ${index + 1} ---\n${chunk}\n---`);
      });
    }


    // 4. Генерируем финальный ответ через Ollama
    const finalAnswer = await generateFinalAnswer(userQuery, chunks);
    console.log(`[OLLAMA] Final Answer: ${finalAnswer}`);

  } catch (error) {
    console.error("[ERROR] Pipeline failed:", error);
  }
  console.log(`--- End of Test for Query: \"${userQuery}\" ---\n`);
}

(async () => {
  const query = process.argv[2];
  if (!query) {
    console.error("Please provide a query as a command-line argument.");
    console.log("Usage: bun run scripts/run-query-test.ts \"Your test query here\"");
    process.exit(1);
  }
  await testQueryPipeline(query);
})(); 