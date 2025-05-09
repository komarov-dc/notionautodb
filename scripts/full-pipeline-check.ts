import { QdrantClient } from "@qdrant/js-client-rest";
import { aggregateByCompany, buildCompanyChunk } from '../notion/notion-client';
import { getEmbedding } from '../ollama-llm';
import { doubleFilter } from '../filterUserQuery';
import { improveUserQuery, generateFinalAnswer } from '../ollama-llm';

const QDRANT_URL = "http://localhost:6333";
const COLLECTION = "lpm_partners_demo";
const TEST_QUESTIONS = [
  "Нужен партнёр для приема платежей в Бразилии, валюта BRL, минимальная комиссия.",
  "Какие партнёры работают с США и принимают USD?",
  "Партнёры с минимальной комиссией для Европы.",
  "Требуется быстрый вывод средств в криптовалюте.",
  "Какие есть риски при работе с партнёрами из Азии?"
];

async function ensureNamedCollection(client: QdrantClient, expectedSize: number) {
  let info;
  try {
    info = await client.getCollection(COLLECTION);
    console.log('Текущая схема коллекции:', JSON.stringify(info.vectors));
  } catch (e) {
    console.warn('Коллекция не найдена, будет создана заново.');
    info = null;
  }
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

async function main() {
  console.log('--- ШАГ 1: Проверка доступа к Notion и получение данных...');
  const companies = await aggregateByCompany();
  const validCompanies = Object.entries(companies).filter(([name]) => name && name !== 'Unknown');
  if (validCompanies.length === 0) {
    console.error('Нет валидных компаний в Notion! Проверь ID базы и интеграцию.');
    process.exit(1);
  }
  console.log('Найдено компаний в Notion:', validCompanies.length);

  // Получаем первую embedding для определения размерности
  const [firstCompany, firstRows] = validCompanies[0];
  const firstChunk = buildCompanyChunk(firstCompany, firstRows);
  const firstEmbedding = await getEmbedding(firstChunk);
  console.log('Размерность embedding:', firstEmbedding.length);

  console.log('--- ШАГ 2: Проверка/создание коллекции Qdrant...');
  const qdrant = new QdrantClient({ url: QDRANT_URL });
  await ensureNamedCollection(qdrant, firstEmbedding.length);

  console.log('--- ШАГ 3: Инжест всех компаний в Qdrant...');
  let count = 0;
  for (const [company, rows] of validCompanies) {
    const chunkContent = buildCompanyChunk(company, rows);
    if (!chunkContent.trim()) continue;
    const embedding = await getEmbedding(chunkContent);
    // Валидация embedding
    const isValidEmbedding = Array.isArray(embedding) && embedding.length === firstEmbedding.length && embedding.every(x => typeof x === 'number' && isFinite(x));
    if (!isValidEmbedding) {
      console.error(`❌ Невалидный embedding для компании ${company}:`, embedding);
      continue;
    }
    // Валидация payload
    const point = {
      id: `company_${company.replace(/[^a-zA-Z0-9_]/g, '_')}`,
      vectors: { text: embedding },
      payload: { companyName: company, chunk: chunkContent },
    };
    let payloadOk = true;
    try {
      JSON.stringify(point.payload);
    } catch (e) {
      payloadOk = false;
      console.error(`❌ Payload не сериализуется для компании ${company}:`, point.payload);
    }
    // Логируем point перед upsert
    console.log('--- Point для upsert:', JSON.stringify({ ...point, vectors: { text: 'Array[' + embedding.length + ']' } }, null, 2));
    if (!payloadOk) continue;
    try {
      await qdrant.upsert(COLLECTION, { points: [point], wait: true });
    } catch (e) {
      console.error(`❌ Ошибка upsert для компании ${company}:`, e);
      continue;
    }
    count++;
    if (count % 10 === 0) console.log(`Upserted ${count} компаний...`);
  }
  console.log(`Инжест завершён. Всего upsert: ${count}`);

  console.log('--- ШАГ 4: Проверка наличия данных в Qdrant...');
  const result = await qdrant.scroll(COLLECTION, { with_payload: true, limit: 2000 });
  const companiesQdrant = result.points.map((p: any) => p.payload.companyName).filter(Boolean);
  const uniqueCompaniesQdrant = [...new Set(companiesQdrant)];
  console.log('Компаний в Qdrant:', uniqueCompaniesQdrant.length);
  if (uniqueCompaniesQdrant.length === 0) {
    console.error('Qdrant пуст! Проверь логи выше.');
    process.exit(1);
  }

  console.log('--- ШАГ 5: Тестовый поиск и генерация ответа...');
  for (const question of TEST_QUESTIONS) {
    console.log('\n---\nВопрос:', question);
    const isRelevant = await doubleFilter(question);
    if (!isRelevant) {
      console.log('Запрос не прошёл фильтрацию.');
      continue;
    }
    const improved = await improveUserQuery(question);
    console.log('Структурированный запрос:', improved);
    const embedding = await getEmbedding(improved);
    const result = await qdrant.search(COLLECTION, {
      vector: { name: "text", vector: embedding },
      limit: 3,
      with_payload: true
    });
    const chunks = result.map((r: any) => r.payload.chunk || JSON.stringify(r.payload));
    console.log('Найдено чанков:', chunks.length);
    const answer = await generateFinalAnswer(question, chunks);
    console.log('Ответ:', answer);
  }
  console.log('\n--- ПОЛНЫЙ ПАЙПЛАЙН ПРОЙДЕН УСПЕШНО ---');
}

main().catch(e => { console.error('FATAL ERROR:', e); process.exit(1); }); 