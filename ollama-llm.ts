import { Ollama } from 'ollama';
import { IMPROVE_QUERY_PROMPT, FINAL_ANSWER_PROMPT } from './ollama-prompts';

const ollama = new Ollama({ host: 'http://localhost:11434' });

const LLM_MODEL = 'gemma3:27b'; // исправлено на актуальное имя модели

// Улучшение/нормализация запроса пользователя через system prompt
export async function improveUserQuery(userQuery: string): Promise<string> {
  const systemPrompt = IMPROVE_QUERY_PROMPT;
  const { message } = await ollama.chat({
    model: LLM_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userQuery }
    ]
  });Зна
  return message.content.trim();
}

// Генерация финального ответа для пользователя на основе найденных чанков
export async function generateFinalAnswer(userQuery: string, chunks: string[]): Promise<string> {
  const systemPrompt = FINAL_ANSWER_PROMPT;
  const context = chunks.map((c, i) => `Партнёр ${i + 1}: ${c}`).join('\n');
  const { message } = await ollama.chat({
    model: LLM_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Запрос: ${userQuery}\n\nНайдено:\n${context}` }
    ]
  });
  return message.content.trim();
}

// Получить эмбеддинг текста через Ollama
export async function getEmbedding(text: string): Promise<number[]> {
  const { embedding } = await ollama.embeddings({
    model: 'mxbai-embed-large',
    prompt: text
  });
  return embedding;
} 