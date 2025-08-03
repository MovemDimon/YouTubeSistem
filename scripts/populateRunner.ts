import producer from '../src/producer';
import { fetch } from 'undici';

const STATUS_URL = 'https://raw.githubusercontent.com/your-username/your-repo/main/.status.json';
const GITHUB_TOKEN = process.env.GH_CONTENTS_TOKEN!; // secret تعریف شده در GitHub

const env = {
  YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY!,
  YOUTUBE_USERS: process.env.YOUTUBE_USERS!,
  TOTAL_COMMENTS: "10000",
  COMMENT_QUEUE: {
    send: async (message: any) => {
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/queues/comment-queue/messages`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.CF_API_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ body: message })
        }
      );
      if (!res.ok) throw new Error(`Failed: ${await res.text()}`);
    }
  }
};

async function getStatus(): Promise<{ started_at: string; posted_comments: number }> {
  const res = await fetch(STATUS_URL);
  if (!res.ok) throw new Error('Failed to fetch status');
  return await res.json();
}

async function updateStatus(newCount: number) {
  const body = JSON.stringify({
    started_at: new Date().toISOString(),
    posted_comments: newCount
  }, null, 2);

  const res = await fetch(`https://api.github.com/repos/your-username/your-repo/contents/.status.json`, {
    method: 'PUT',
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: 'Update posted_comments',
      content: Buffer.from(body).toString('base64'),
      sha: await getCurrentSha(),
      branch: 'main'
    })
  });

  if (!res.ok) throw new Error(await res.text());
}

async function getCurrentSha(): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/your-username/your-repo/contents/.status.json`, {
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`
    }
  });
  const json = await res.json();
  return json.sha;
}

async function main() {
  try {
    const status = await getStatus();
    const elapsed = Date.now() - new Date(status.started_at).getTime();
    const limitReached = status.posted_comments >= 10000;
    const timeExceeded = elapsed > 20 * 60 * 60 * 1000; // 20 ساعت

    if (limitReached || timeExceeded) {
      console.log('⏹️ سیستم متوقف شده: سقف کامنت یا زمان تمام شده.');
      return;
    }

    console.log('🟢 سیستم در حال اجرا...');
    await producer.fetchAndProduce(env.COMMENT_QUEUE, env as any);

    const newCount = status.posted_comments + parseInt(env.TOTAL_COMMENTS);
    await updateStatus(newCount);
    console.log('✅ پیام‌ها به صف ارسال شدند.');
  } catch (error) {
    console.error('❌ خطا:', error);
    process.exit(1);
  }
}

main();
