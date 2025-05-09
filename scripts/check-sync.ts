import { aggregateByCompany } from '../notion/notion-client';
import { QdrantClient } from '@qdrant/js-client-rest';

const QDRANT_URL = 'http://localhost:6333';
const COLLECTION = 'lpm_partners_demo';

async function main() {
  // Получаем компании из Notion
  const companiesNotionObj = await aggregateByCompany();
  const companiesNotion = Object.keys(companiesNotionObj).filter((name) => name && name !== 'Unknown');
  console.log('Компаний в Notion:', companiesNotion.length);

  // Получаем компании из Qdrant
  const qdrant = new QdrantClient({ url: QDRANT_URL });
  const result = await qdrant.scroll(COLLECTION, {
    with_payload: true,
    limit: 2000 // увеличить при необходимости
  });
  const companiesQdrant = result.points.map((p: any) => p.payload.companyName).filter(Boolean);
  const uniqueCompaniesQdrant = [...new Set(companiesQdrant)];
  console.log('Компаний в Qdrant:', uniqueCompaniesQdrant.length);

  // Сравниваем
  const notInQdrant = companiesNotion.filter((c) => !uniqueCompaniesQdrant.includes(c));
  const notInNotion = uniqueCompaniesQdrant.filter((c) => !companiesNotion.includes(c));

  if (notInQdrant.length > 0) {
    console.log('Компании, которых нет в Qdrant:', notInQdrant);
  } else {
    console.log('Все компании из Notion есть в Qdrant!');
  }
  if (notInNotion.length > 0) {
    console.log('Компании, которых нет в Notion, но есть в Qdrant:', notInNotion);
  }
}

main().catch(console.error); 