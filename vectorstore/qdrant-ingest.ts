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

async function ensureCleanCollection(client: QdrantClient) { 
  try {
    console.log('Deleting existing collection (if any) for a clean dummy point test...');
    await client.deleteCollection(COLLECTION);
    console.log('Collection deleted for dummy test.');
  } catch (e:any) {
    console.warn("Collection might not exist or another error during deletion for dummy test, proceeding to create.");
  }
  await client.createCollection(COLLECTION, {
    vectors: { text: { size: 1024, distance: "Cosine" } } 
  });
  console.log('Коллекция создана/очищена для теста dummy точки.');
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
    await ensureCleanCollection(testClient);
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
    await ensureCleanCollection(qdrant);
    const companies = await aggregateByCompany();
    let count = 0;
    let firstEmbeddingLength: number | null = null;
    for (const [company, rows] of Object.entries(companies)) {
      if (!company || company === 'Unknown') continue;
      const chunkContent = buildCompanyChunk(company, rows);
      if (!chunkContent.trim()) continue;
      const embedding = await getEmbedding(chunkContent);
      if (firstEmbeddingLength === null) {
        firstEmbeddingLength = embedding.length;
        console.log(`DEBUG: embedding length for first chunk: ${firstEmbeddingLength}`);
      }
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