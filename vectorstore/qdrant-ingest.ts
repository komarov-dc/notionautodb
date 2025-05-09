import { QdrantClient } from "@qdrant/js-client-rest";
// import fs from "fs"; // No longer needed for this focused test
import { getEmbedding } from '../ollama-llm'; // Not used in the dummy test IIFE but kept for other functions
import { fetchFirstNRows, aggregateByCompany, buildCompanyChunk } from '../notion/notion-client'; // Same as above

const QDRANT_URL = "http://localhost:6333";
const COLLECTION = "lpm_partners_demo";
// const EMBED_MODEL = "mxbai-embed-large"; // Not used in this specific test run

// Keep qdrant client global for original functions if they were to be used, 
// but the test IIFE will use its own instance for clarity.
let qdrant: QdrantClient | null = null; 

async function ensureNamedCollection(client: QdrantClient, expectedSize: number) {
  // Получить схему коллекции
  let info;
  try {
    info = await client.getCollection(COLLECTION);
    console.log('Текущая схема коллекции:', JSON.stringify(info.vectors));
  } catch (e) {
    console.warn('Коллекция не найдена, будет создана заново.');
    info = null;
  }
  // Проверяем, что коллекция named и размерность совпадает
  const isNamed = info && info.vectors && info.vectors.text && typeof info.vectors.text.size === 'number';
  const correctSize = isNamed && info.vectors.text.size === expectedSize;
  if (!isNamed || !correctSize) {
    if (info) {
      console.log('Удаляю коллекцию, т.к. она не named или размерность не совпадает.');
      await client.deleteCollection(COLLECTION);
    }
    await client.createCollection(COLLECTION, {
      vectors: { text: { size: expectedSize, distance: 'Cosine' } }
    });
    console.log('Коллекция создана с именованным вектором text и размерностью', expectedSize);
  } else {
    console.log('Коллекция уже корректная (named, размерность совпадает).');
  }
}

async function upsertSingleDummyPointForTest(client: QdrantClient) { 
  const dummyEmbedding = new Array(1024).fill(0.1);
  const testPointId = "test_dummy_point_012"; // New ID for fresh test
  const testPoint = {
    id: testPointId, 
    vector: { text: dummyEmbedding }, 
    payload: { companyName: "DummyCompanyForTest", chunk: "This is a hardcoded dummy chunk for Qdrant upsert test." },
  };

  try {
    console.log("Attempting to upsert DUMMY TEST POINT with ID:", testPoint.id);
    await client.upsert(COLLECTION, { points: [testPoint], wait: true }); // Using client.upsert directly
    console.log(`Successfully upserted DUMMY TEST POINT ID: ${testPoint.id}`);
    return true;
  } catch (e: any) {
    const errMsg = e?.response?.data || e?.message || e;
    // Log the full error object if possible, and more details from the point
    console.error(
      'ОШИБКА UPSERT DUMMY ТЕСТОВОЙ ТОЧКИ:',
      {
        errMsg,
        pointId: testPoint.id,
        vectorSample: dummyEmbedding.slice(0,3),
        // CAUTION: Do not log full embedding or full point if too large for console
        errorDetail: JSON.stringify(e, Object.getOwnPropertyNames(e)) // Try to get more error details
      }
    );
    return false;
  }
}

// --- MAIN TEST EXECUTION BLOCK for DUMMY POINT --- 
if (!process.env.INGEST_REAL) {
  (async () => {
    console.log("--- Starting DUMMY POINT Upsert Test (Upsert ONLY) --- ");
    const testClient = new QdrantClient({ url: QDRANT_URL });
    const dummyEmbedding = new Array(1024).fill(0.1);
    await ensureNamedCollection(testClient, dummyEmbedding.length);
    console.log('DEBUG: embedding length for dummy:', dummyEmbedding.length);
    const success = await upsertSingleDummyPointForTest(testClient);
    if (success) {
      console.log("Dummy point upsert reported success by the function. Manual check in Qdrant needed or use separate query script.");
    } else {
      console.log("Dummy point upsert reported failure by the function.");
    }
    console.log("--- Finished DUMMY POINT Upsert Test (Upsert ONLY) --- ");
  })();
}


// Original upsertCompanyChunk and other functions remain below for when re-enabled
// export async function upsertCompanyChunk(companyName: string, chunk: string) { ... 

// Example of the original IIFE for full ingestion (currently bypassed by the test IIFE above)
/*
(async () => {
  if (!qdrant) qdrant = new QdrantClient({ url: QDRANT_URL });
  await ensureCleanCollection(qdrant); // ensureCleanCollection replaces original ensureCollection
  const companies = await aggregateByCompany();
  for (const [company, rows] of Object.entries(companies)) {
    const chunkContent = buildCompanyChunk(company, rows);
    await upsertCompanyChunk(company, chunkContent); // This would be the original function
  }
})();
*/

// === REAL INGESTION SCRIPT: Notion -> Qdrant ===
if (require.main === module && process.env.INGEST_REAL === '1') {
  (async () => {
    const qdrant = new QdrantClient({ url: QDRANT_URL });
    // Получаем первую embedding для определения размерности
    const companies = await aggregateByCompany();
    let firstEmbeddingLength: number | null = null;
    for (const [company, rows] of Object.entries(companies)) {
      if (!company || company === 'Unknown') continue;
      const chunkContent = buildCompanyChunk(company, rows);
      if (!chunkContent.trim()) continue;
      const embedding = await getEmbedding(chunkContent);
      firstEmbeddingLength = embedding.length;
      break;
    }
    if (!firstEmbeddingLength) throw new Error('Не удалось определить размерность embedding!');
    await ensureNamedCollection(qdrant, firstEmbeddingLength);
    let count = 0;
    for (const [company, rows] of Object.entries(companies)) {
      if (!company || company === 'Unknown') continue;
      const chunkContent = buildCompanyChunk(company, rows);
      if (!chunkContent.trim()) continue;
      const embedding = await getEmbedding(chunkContent);
      console.log(`DEBUG: embedding length for ${company}:`, embedding.length);
      const point = {
        id: `company_${company.replace(/[^a-zA-Z0-9_]/g, '_')}`,
        vector: { text: embedding },
        payload: { companyName: company, chunk: chunkContent },
      };
      await qdrant.upsert(COLLECTION, { points: [point], wait: true });
      count++;
      if (count % 10 === 0) console.log(`Upserted ${count} companies...`);
    }
    console.log(`Ingestion complete. Upserted ${count} companies.`);
  })();
}

// The if (require.main === module) for fetching samples is also bypassed by the test IIFE for now.
/*
if (require.main === module) {
  (async () => {
     console.log("Fetching sample points from Qdrant (if any after dummy test)...");
     const client = new QdrantClient({ url: QDRANT_URL });
     // ... rest of sample fetching logic ...
  })();
}
*/ 