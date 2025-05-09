import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_API_KEY });
// const DATABASE_ID_OLD = 'dadd6751229446d8bd004e790b65a8a8'; // OLD HARDCODED ID
// const DATABASE_ID_ENV = process.env.NOTION_DATABASE_ID_1; // USING ENV VARIABLE

// const DATABASE_ID: string = DATABASE_ID_ENV; // Ensure it's typed as string after check

const DATABASE_ID: string = "dadd6751229446d8bd004e790b65a8a8"; // Using the presumed correct DB ID from URL analysis

// Получить все страницы из базы
export async function fetchAllRows() {
  let results: any[] = [];
  let cursor: string | undefined = undefined;
  do {
    const response = await notion.databases.query({
      database_id: DATABASE_ID, // Now using the guaranteed string type
      start_cursor: cursor,
      page_size: 100,
    });
    results = results.concat(response.results);
    cursor = response.has_more ? response.next_cursor as string : undefined;
  } while (cursor);
  return results;
}

// Получить название компании по relation id с кэшированием
const partnerNameCache: Record<string, string> = {};
const countryNameCache: Record<string, string> = {};

async function getRelatedPageTitle(pageId: string, notionClient: Client, cache: Record<string, string>): Promise<string> {
  if (cache[pageId]) return cache[pageId];
  try {
    const page = await notionClient.pages.retrieve({ page_id: pageId }) as any;
    for (const key in page.properties) {
      const prop = page.properties[key];
      if (prop.type === 'title' && prop.title.length > 0) {
        cache[pageId] = prop.title[0].plain_text;
        return cache[pageId];
      }
    }
  } catch (error) {
    console.warn(`Failed to retrieve page title for ID ${pageId}:`, error);
    cache[pageId] = 'Unknown Related Page';
    return 'Unknown Related Page';
  }
  cache[pageId] = 'Unknown Related Page';
  return 'Unknown Related Page';
}

export async function getPartnerNameByRelationId(pageId: string, notionClient: Client): Promise<string> {
  if (partnerNameCache[pageId]) return partnerNameCache[pageId];
  const page = await notionClient.pages.retrieve({ page_id: pageId }) as any;
  for (const key in page.properties) {
    const prop = page.properties[key];
    if (prop.type === 'title' && prop.title.length > 0) {
      partnerNameCache[pageId] = prop.title[0].plain_text;
      return partnerNameCache[pageId];
    }
  }
  partnerNameCache[pageId] = 'Unknown';
  return 'Unknown';
}

export async function getCountryNamesFromRelations(relationIds: Array<{ id: string }>, notionClient: Client): Promise<string[]> {
  const countryNames: string[] = [];
  if (relationIds && relationIds.length > 0) {
    for (const rel of relationIds) {
      const name = await getRelatedPageTitle(rel.id, notionClient, countryNameCache);
      if (name !== 'Unknown Related Page') {
        countryNames.push(name);
      }
    }
  }
  return countryNames;
}

// Агрегировать заявки по реальному Partner name
export async function aggregateByCompany() {
  const rows = await fetchAllRows();
  const companies: Record<string, any[]> = {};
  for (const row of rows) {
    let name = 'Unknown';
    const partnerRel = row.properties['Partner name']?.relation;
    if (partnerRel && partnerRel.length > 0) {
      name = await getPartnerNameByRelationId(partnerRel[0].id, notion);
    }

    const countryRelationArray = row.properties['Country']?.relation;
    if (countryRelationArray && countryRelationArray.length > 0) {
      (row as any).processedCountries = await getCountryNamesFromRelations(countryRelationArray, notion);
    } else {
      (row as any).processedCountries = [];
    }

    if (!companies[name]) companies[name] = [];
    companies[name].push(row);
  }
  return companies;
}

// Пример: получить агрегированный чанк по компании
export function buildCompanyChunk(companyName: string, companyRows: any[]): string {
  if (!companyRows.length) return '';
  const offers = companyRows.map(row => {
    const countryString = (row as any).processedCountries && (row as any).processedCountries.length > 0 ? (row as any).processedCountries.join(', ') : '';
    return [
      `Offer: ${row.properties['Offer Reference']?.title?.[0]?.plain_text || ''}`,
      `Country: ${countryString}`,
      `Currency: ${row.properties['*Currency']?.multi_select?.map((c: any) => c.name).join(', ') || ''}`,
      `Status: ${row.properties['Status']?.status?.name || ''}`,
      `Payment fee: ${row.properties['*Payment fee %']?.rich_text?.[0]?.plain_text || row.properties['*Payment fee %']?.number || ''}`,
      `Risk: ${row.properties['*Type of Risk']?.multi_select?.map((r: any) => r.name).join(', ') || ''}`,
      `For LPM: ${row.properties['*For LPM']?.relation?.length || 0}`
    ].join('; ');
  });
  return [
    `Partner: ${companyName}`,
    ...offers
  ].join('\n');
}

// Получить первые N строк из базы
export async function fetchFirstNRows(n: number) {
  let results: any[] = [];
  let cursor: string | undefined = undefined;
  do {
    const response = await notion.databases.query({
      database_id: DATABASE_ID, // Now using the guaranteed string type
      start_cursor: cursor,
      page_size: Math.min(n - results.length, 100),
    });
    results = results.concat(response.results);
    cursor = response.has_more ? response.next_cursor as string : undefined;
  } while (cursor && results.length < n);
  return results.slice(0, n);
}

// Временная функция main для вывода первой сырой строки из Notion
if (require.main === module) {
  (async () => {
    const rows = await fetchAllRows();
    if (rows.length > 0) {
      console.log('Пример сырой строки из Notion:');
      console.dir(rows[0], { depth: 5 });
    } else {
      console.log('Нет строк в базе Notion.');
    }
  })();
}

// Временная функция main для вывода количества компаний и примера чанка
if (require.main === module) {
  (async () => {
    const companies = await aggregateByCompany();
    const validCompanies = Object.entries(companies).filter(([name]) => name && name !== 'Unknown');
    console.log('Всего уникальных компаний:', validCompanies.length);
    if (validCompanies.length > 0) {
      const [firstCompany, rows] = validCompanies[0];
      const chunk = buildCompanyChunk(firstCompany, rows);
      console.log('Пример чанка для компании:', firstCompany);
      console.log(chunk);
    } else {
      console.log('Нет валидных компаний с заполненным названием.');
    }
  })();
} 