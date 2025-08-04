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

async function getStatus(GH_TOKEN: string): Promise<{ posted_comments: number; started_at: string }> {
  const res = await fetch("https://api.github.com/repos/MovemDimon/YouTubeSistem/contents/.status.json", {
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: "application/vnd.github.v3+json"
    }
  });
  const data = await res.json();
  const content = Buffer.from(data.content, "base64").toString();
  return JSON.parse(content);
}

async function getCurrentSha(GH_TOKEN: string): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/MovemDimon/YouTubeSistem/contents/.status.json`, {
    headers: { 'Authorization': `Bearer ${GH_TOKEN}` }
  });
  const json = await res.json();
  return json.sha;
}

async function updateStatus(GH_TOKEN: string, newCount: number) {
  const body = JSON.stringify({
    started_at: new Date().toISOString(),
    posted_comments: newCount
  }, null, 2);

  const res = await fetch(`https://api.github.com/repos/MovemDimon/YouTubeSistem/contents/.status.json`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${GH_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: 'Update posted_comments after successful send',
      content: Buffer.from(body).toString('base64'),
      sha: await getCurrentSha(GH_TOKEN),
      branch: 'main'
    })
  });

  if (!res.ok) throw new Error(await res.text());
}

export default {
  async scheduled(event: ScheduledEvent, env: any, ctx: ExecutionContext) {
    const usedMap = new Map<string, Set<string>>();
    const list = await env.COMMENT_KV.list({ prefix: 'comment-', limit: 5 });
    let sentCount = 0;

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
      sentCount++;
    }

    if (sentCount > 0) {
      const status = await getStatus(env.GH_CONTENTS_TOKEN);
      await updateStatus(env.GH_CONTENTS_TOKEN, status.posted_comments + sentCount);
    }
  }
}
