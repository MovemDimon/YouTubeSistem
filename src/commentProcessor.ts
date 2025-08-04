// src/commentProcessor.ts
import { refreshAccessToken, postComment, postReply } from './youtube';

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

async function fetchLines(url: string): Promise<string[]> {
  const res = await fetch(url);
  return (await res.text()).split('\n').map(l => l.trim()).filter(Boolean);
}

function pickUnique(key: string, items: string[], usedSet: Set<string>): string {
  const pool = items.filter(i => !usedSet.has(i));
  const chosen = pool.length ? pool[Math.floor(Math.random() * pool.length)] : items[Math.floor(Math.random() * items.length)];
  usedSet.add(chosen);
  return chosen;
}

export default {
  async scheduled(event: ScheduledEvent, env: any, ctx: ExecutionContext) {
    const usedMap = new Map<string, Set<string>>();
    const list = await env.COMMENT_KV.list({ prefix: 'comment-', limit: 5 });

    for (const { name } of list.keys) {
      const raw = await env.COMMENT_KV.get(name);
      if (!raw) continue;
      const { videoId, lang, accountIndex } = JSON.parse(raw);

      const accounts = JSON.parse(env.YOUTUBE_USERS);
      const account = accounts[accountIndex];
      const token = await refreshAccessToken(account);

      const commentLines = await fetchLines(`https://raw.githubusercontent.com/MovemDimon/YouTubeSistem/main/data/comments/${lang}.txt`);
      const comment = pickUnique(videoId, commentLines, usedMap.get(videoId) || new Set());
      const threadId = await postComment(token, videoId, comment);

      const replyCount = Math.floor(Math.random() * 4);
      if (replyCount > 0) {
        const replies = await fetchLines(`https://raw.githubusercontent.com/MovemDimon/YouTubeSistem/main/data/replies/${lang}.txt`);
        const replyIndexes = shuffle([...Array(accounts.length).keys()].filter(i => i !== accountIndex)).slice(0, replyCount);
        for (const idx of replyIndexes) {
          const rToken = await refreshAccessToken(accounts[idx]);
          await postReply(rToken, threadId, pickUnique(threadId, replies, new Set()));
          await new Promise(r => setTimeout(r, 3000 + Math.random() * 4000));
        }
      }

      await env.COMMENT_KV.delete(name);
    }
  }
}
