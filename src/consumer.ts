// src/consumer.ts
import { refreshAccessToken, postComment, postReply } from './youtube';
import { Queue } from '@cloudflare/workers-types';

const recentMap = new Map<string, Set<string>>();

async function fetchLines(url: string): Promise<string[]> {
  const res = await fetch(url);
  return (await res.text()).split('\n').map(line => line.trim()).filter(line => line);
}

function pickUnique(key: string, items: string[], limit = 100): string {
  if (!recentMap.has(key)) recentMap.set(key, new Set());
  const used = recentMap.get(key)!;
  const pool = items.filter(i => !used.has(i));
  const choice = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : items[Math.floor(Math.random() * items.length)];
  used.add(choice);
  if (used.size > limit) used.clear();
  return choice;
}

function shuffleArray(array: any[]) {
  return array.sort(() => Math.random() - 0.5);
}

async function processMessage(msg: any, queue: Queue, env: any) {
  try {
    const { videoId, lang, accountIndex } = msg.body;
    const accounts = JSON.parse(env.YOUTUBE_USERS);
    const account = accounts[accountIndex];
    const token = await refreshAccessToken(account);

    const comments = await fetchLines(`https://raw.githubusercontent.com/MovemDimon/YouTubeSistem/main/data/comments/${lang}.txt`);
    const mainText = pickUnique(videoId, comments);
    const threadId = await postComment(token, videoId, mainText);

    await new Promise(r => setTimeout(r, 15000 + Math.random() * 10000)); // delay 15–25s

    const replyCount = Math.floor(Math.random() * 4); // 0–3
    if (replyCount > 0) {
      const replies = await fetchLines(`https://raw.githubusercontent.com/MovemDimon/YouTubeSistem/main/data/replies/${lang}.txt`);
      const replyAccounts = shuffleArray([...Array(accounts.length).keys()].filter(i => i !== accountIndex)).slice(0, replyCount);

      for (const idx of replyAccounts) {
        const replyToken = await refreshAccessToken(accounts[idx]);
        await postReply(replyToken, threadId, pickUnique(threadId, replies));
        await new Promise(r => setTimeout(r, 3000 + Math.random() * 4000));
      }
    }

    await new Promise(r => setTimeout(r, 45000 + Math.random() * 15000)); // 45–60s
    await queue.delete(msg.receipt);
  } catch (error) {
    console.error('❌ Error processing message:', error);
    throw error;
  }
}

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext) {
    const queue = env.COMMENT_QUEUE;
    const messages = await queue.receive({ maxMessages: 10 });
    if (!messages?.length) return new Response('Queue empty', { status: 200 });

    messages.forEach(msg => ctx.waitUntil(
      processMessage(msg, queue, env).catch(e => console.error(`Failed: ${e}`))
    ));

    return new Response(`Processing ${messages.length} messages`);
  }
};
