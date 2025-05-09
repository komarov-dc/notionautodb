import { Ollama } from 'ollama';
import { QUICK_FILTER_PROMPT, DEEP_FILTER_PROMPT } from './ollama-prompts';
const ollama = new Ollama({ host: 'http://localhost:11434' });

export async function doubleFilter(userQuery: string): Promise<boolean> {
  // Первый фильтр
  const quick = await ollama.chat({
    model: 'gemma3:12b',
    messages: [
      { role: 'system', content: QUICK_FILTER_PROMPT },
      { role: 'user', content: userQuery }
    ]
  });
  const quickAnswer = quick.message.content.trim().toLowerCase();
  if (quickAnswer === 'no') return false;
  // Второй фильтр
  const deep = await ollama.chat({
    model: 'gemma3:12b',
    messages: [
      { role: 'system', content: DEEP_FILTER_PROMPT },
      { role: 'user', content: userQuery }
    ]
  });
  const deepAnswer = deep.message.content.trim().toLowerCase();
  // Логирование для аудита
  console.log(`[FILTER1] "${userQuery}" => "${quickAnswer}" | [FILTER2] => "${deepAnswer}"`);
  return deepAnswer === 'yes';
} 