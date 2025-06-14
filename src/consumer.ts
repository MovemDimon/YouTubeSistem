import { refreshAccessToken, postComment, postReply } from './youtube';
import fs from 'fs';
import path from 'path';

const recentMap = new Map<string, Set<string>>();

async function fetchLines(url: string): Promise<string[]> {
  const res = await fetch(url);
  const text = await res.text();
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line);
}

function pickUnique(key: string, items: string[], limit = 50): string {
  if (!recentMap.has(key)) {
    recentMap.set(key, new Set());
  }
  const used = recentMap.get(key)!;
  const pool = items.filter(i => !used.has(i));
  const choice = pool.length > 0
    ? pool[Math.floor(Math.random() * pool.length)]
    : items[Math.floor(Math.random() * items.length)];
  used.add(choice);
  if (used.size > limit) used.clear();
  return choice;
}

function saveCommentToLikesFile(commentId: string, lang: string) {
  const file = path.join(__dirname, '../likes.json');
  let data: any = { comments: [] };
  if (fs.existsSync(file)) {
    data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  }

  const alreadyExists = data.comments.some((c: any) => c.commentId === commentId);
  if (!alreadyExists) {
    data.comments.push({
      commentId,
      lang,
      totalLikes: null,
      likedSoFar: 0
    });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  }
}

export default {
  async fetch(_req: Request, env: any) {
    const queue = env.COMMENT_QUEUE;
    const msg = await queue.receive();
    if (!msg) return new Response('Queue empty', { status: 200 });

    const { videoId, lang, accountIndex } = msg.body;
    const accounts = JSON.parse(env.YOUTUBE_USERS);
    const account = accounts[accountIndex];
    const token = await refreshAccessToken(account);

    try {
      // Post main comment
      const comments = await fetchLines(
        `https://raw.githubusercontent.com/yourusername/dimonium-auto-comment/main/data/comments/${lang}.txt`
      );
      const mainText = pickUnique(videoId, comments);
      const threadId = await postComment(token, videoId, mainText);

      // ✅ ذخیره کردن commentId در likes.json
      saveCommentToLikesFile(threadId, lang);

      // Random delay before replies
      await new Promise(r => setTimeout(r, 7000 + Math.random() * 3000));

      // Decide number of replies (0 to 2)
      const replyCount = Math.floor(Math.random() * 3);
      if (replyCount > 0) {
        const replies = await fetchLines(
          `https://raw.githubusercontent.com/yourusername/dimonium-auto-comment/main/data/replies/${lang}.txt`
        );
        const replyIdx = Array.from({ length: accounts.length }, (_, i) => i)
          .sort(() => Math.random() - 0.5)
          .slice(0, replyCount);

        for (const idx of replyIdx) {
          const repToken = await refreshAccessToken(accounts[idx]);
          const replyText = pickUnique(threadId, replies);
          await postReply(repToken, threadId, replyText);
          await new Promise(r => setTimeout(r, 5000 + Math.random() * 5000));
        }
      }

      await queue.delete(msg.receipt);
      return new Response('Comment and replies posted', { status: 200 });

    } catch (error) {
      console.error('Error in consumer:', error);
      return new Response('Retry', { status: 500 });
    }
  }
};
