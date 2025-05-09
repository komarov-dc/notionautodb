import { Telegraf } from 'telegraf';
import { improveUserQuery, generateFinalAnswer, getEmbedding } from './ollama-llm';
import { QdrantClient } from '@qdrant/js-client-rest';
import { doubleFilter } from './filterUserQuery';

const QDRANT_URL = 'http://localhost:6333';
const COLLECTION = 'lpm_partners_demo';
const EMBED_MODEL = 'mxbai-embed-large';

const bot = new Telegraf(process.env.BOT_TOKEN!);
const qdrant = new QdrantClient({ url: QDRANT_URL });

async function searchQdrant(embedding: number[], topK = 3) {
  const result = await qdrant.search(COLLECTION, {
    vector: {
      name: "text",
      vector: embedding
    },
    limit: topK,
    with_payload: true
  });
  return result.map((r: any) => r.payload.chunk || JSON.stringify(r.payload));
}

bot.start((ctx) => ctx.reply('Привет! Я бот для поиска лучших партнёров по твоим условиям. Просто напиши свой запрос.'));
bot.help((ctx) => ctx.reply('Напиши требования к партнёру (страна, комиссия, валюта и т.д.), и я подберу лучшие варианты.'));

bot.on('text', async (ctx) => {
  const userQuery = ctx.message.text;
  if (!(await doubleFilter(userQuery))) {
    await ctx.reply('Я могу помочь только с подбором финансовых партнёров. Пожалуйста, уточните ваш запрос.');
    return;
  }
  console.log(`[TELEGRAM] Новый запрос: ${userQuery}`);
  try {
    // 1. Улучшаем запрос через Ollama
    const improved = await improveUserQuery(userQuery);
    console.log(`[OLLAMA] Структурированный запрос: ${improved}`);
    // 2. Получаем embedding
    const embedding = await getEmbedding(improved);
    console.log(`[EMBEDDING] Вектор получен, длина: ${embedding.length}`);
    // 3. Ищем в Qdrant
    const chunks = await searchQdrant(embedding, 3);
    console.log(`[QDRANT] Найдено чанков: ${chunks.length}`);
    // 4. Генерируем финальный ответ через Ollama
    const answer = await generateFinalAnswer(userQuery, chunks);
    console.log(`[OLLAMA] Ответ для менеджера: ${answer}`);
    await ctx.reply(answer);
  } catch (e) {
    console.error('[ERROR]', e);
    await ctx.reply('Произошла ошибка при обработке запроса. Попробуйте позже.');
  }
});

bot.launch();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM')); 