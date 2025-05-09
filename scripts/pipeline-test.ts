import { doubleFilter } from '../filterUserQuery';
import { improveUserQuery, generateFinalAnswer } from '../ollama-llm';
import { QdrantClient } from '@qdrant/js-client-rest';

const QDRANT_URL = 'http://localhost:6333';
const COLLECTION = 'lpm_partners_demo';
const EMBED_MODEL = 'mxbai-embed-large';

const TEST_QUESTIONS = [
  "Нужен партнёр для приема платежей в Бразилии, валюта BRL, минимальная комиссия.",
  "Какие партнёры работают с США и принимают USD?",
  "Партнёры с минимальной комиссией для Европы.",
  "Требуется быстрый вывод средств в криптовалюте.",
  "Какие есть риски при работе с партнёрами из Азии?"
];

async function getEmbeddingOllama(text: string): Promise<number[]> {
  const res = await fetch('http://localhost:11434/api/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text })
  });
  const data = await res.json();
  return data.embedding;
}

async function searchQdrant(embedding: number[], topK = 3) {
  const qdrant = new QdrantClient({ url: QDRANT_URL });
  const result = await qdrant.query(COLLECTION, {
    query: embedding,
    using: 'text',
    limit: topK,
    with_payload: true
  });
  return result.points?.map((r: any) => r.payload.chunk || JSON.stringify(r.payload)) || [];
}

async function searchQdrantByEmbedding(embedding: number[]): Promise<any[]> {
  const qdrant = new QdrantClient({ url: QDRANT_URL });
  const result = await qdrant.query(COLLECTION, {
    query: embedding,
    using: 'text',
    limit: 10,
    with_payload: true
  });
  return result.points || [];
}

async function runTests() {
  for (const question of TEST_QUESTIONS) {
    console.log('\n---\nВопрос:', question);

    // 1. Фильтрация
    const isRelevant = await doubleFilter(question);
    if (!isRelevant) {
      console.log('Запрос не прошёл фильтрацию.');
      continue;
    }

    // 2. Улучшение запроса
    const improved = await improveUserQuery(question);
    console.log('Структурированный запрос:', improved);

    // 3. Эмбеддинг
    const embedding = await getEmbeddingOllama(improved);

    // 4. Поиск по Qdrant
    const chunks = await searchQdrant(embedding, 3);
    console.log('Найдено чанков:', chunks.length);

    // 5. Генерация финального ответа
    const answer = await generateFinalAnswer(question, chunks);
    console.log('Ответ:', answer);
  }
}

runTests().catch(console.error); 