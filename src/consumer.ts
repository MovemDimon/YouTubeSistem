import { refreshAccessToken, postComment } from './youtube';

const recentCommentsMap = new Map<string, Set<string>>();

async function fetchComments(lang: string): Promise<string[]> {
  const response = await fetch(`https://raw.githubusercontent.com/yourusername/dimonium-auto-comment/main/data/comments/${lang}.txt`);
  const text = await response.text();
  return text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
}

function pickNonDuplicateComment(comments: string[], videoId: string): string {
  if (!recentCommentsMap.has(videoId)) {
    recentCommentsMap.set(videoId, new Set());
  }
  const used = recentCommentsMap.get(videoId)!;
  const pool = comments.filter(c => !used.has(c));
  const chosen = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : comments[Math.floor(Math.random() * comments.length)];

  used.add(chosen);
  if (used.size > 50) {
    used.clear(); // حافظه تکراری فقط برای چند کامنت اخیر
  }

  return chosen;
}

export default {
  async fetch(_req: Request, env: any) {
    const queue = env.COMMENT_QUEUE;
    const message = await queue.receive();
    if (!message) return new Response('Queue empty', { status: 200 });

    const { videoId, lang, accountIndex } = message.body;
    const accounts = JSON.parse(env.YOUTUBE_USERS);
    const account = accounts[accountIndex];

    try {
      const comments = await fetchComments(lang);
      const comment = pickNonDuplicateComment(comments, videoId);
      const token = await refreshAccessToken(account);
      await postComment(token, videoId, comment);

      const delay = 7000 + Math.floor(Math.random() * 3000);
      await new Promise(res => setTimeout(res, delay));
      await queue.delete(message.receipt);

      return new Response('Comment posted', { status: 200 });

    } catch (e) {
      console.error('Error posting comment:', e);
      return new Response('Retry', { status: 500 });
    }
  }
};
