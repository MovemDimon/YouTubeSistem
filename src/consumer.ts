import { refreshAccessToken, postComment } from './youtube';

async function fetchComments(lang: string): Promise<string[]> {
  const commentsResponse = await fetch(`https://raw.githubusercontent.com/yourusername/dimonium-auto-comment/main/data/comments/${lang}.txt`);
  const text = await commentsResponse.text();
  return text.split('\n').filter(line => line.trim().length > 0);
}

export default {
  async fetch(request: Request, env: any) {
    const queue = env.COMMENT_QUEUE;
    const message = await queue.receive();

    if (!message) {
      return new Response('Queue empty', { status: 200 });
    }

    const { platform, videoId, lang, accountIndex } = message.body;
    const comments = await fetchComments(lang);
    const comment = comments[Math.floor(Math.random() * comments.length)];

    const accounts: {
      client_id: string;
      client_secret: string;
      refresh_token: string;
    }[] = JSON.parse(env.YOUTUBE_USERS);

    try {
      const account = accounts[accountIndex];
      const access_token = await refreshAccessToken(account);
      await postComment(access_token, videoId, comment);
    } catch (e) {
      console.error('Error posting comment:', e);
      return new Response('Retry', { status: 500 });
    }

    await new Promise((resolve) => setTimeout(resolve, 6000 + Math.random() * 2000));
    await queue.delete(message.receipt);

    return new Response('Comment posted', { status: 200 });
  }
};
