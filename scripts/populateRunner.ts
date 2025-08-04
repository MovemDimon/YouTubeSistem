import producer from '../src/producer';
import { fetch } from 'undici';

const GITHUB_TOKEN = process.env.GH_CONTENTS_TOKEN!;
const COMMENT_KV_PUT_URL = `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/storage/kv/namespaces/${process.env.CF_KV_NAMESPACE_ID}/values`;

const env = {
  YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY!,
  YOUTUBE_USERS: process.env.YOUTUBE_USERS!,
  TOTAL_COMMENTS: "10000",
  COMMENT_QUEUE: {
    send: async (message: any) => {
      const id = Date.now().toString();
      const res = await fetch(`${COMMENT_KV_PUT_URL}/comment-${id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${process.env.CF_API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(message)
      });
      if (!res.ok) throw new Error(`Failed to enqueue comment: ${await res.text()}`);
    }
  }
};

async function getStatus(): Promise<{ started_at: string; posted_comments: number }> {
  const res = await fetch("https://api.github.com/repos/MovemDimon/YouTubeSistem/contents/.status.json", {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to fetch status: ${body}`);
  }

  const data = await res.json();
  const content = Buffer.from(data.content, "base64").toString();
  return JSON.parse(content);
}

async function getCurrentSha(): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/MovemDimon/YouTubeSistem/contents/.status.json`, {
    headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}` }
  });
  const json = await res.json();
  return json.sha;
}

async function updateStatus(newCount: number) {
  const body = JSON.stringify({
    started_at: new Date().toISOString(),
    posted_comments: newCount
  }, null, 2);

  const res = await fetch(`https://api.github.com/repos/MovemDimon/YouTubeSistem/contents/.status.json`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
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

async function main() {
  try {
    const status = await getStatus();
    const limitReached = status.posted_comments >= 10000;

    if (limitReached) {
      console.log('⏹️ سیستم متوقف شده: سقف کامنت ارسال شده.');
      return;
    }

    console.log('🟢 سیستم در حال اجرا...');
    await producer.fetchAndProduce(env.COMMENT_QUEUE, env as any);

    const newCount = status.posted_comments + parseInt(env.TOTAL_COMMENTS);
    await updateStatus(newCount);
    console.log('✅ پیام‌ها در KV ذخیره شدند.');
  } catch (error) {
    console.error('❌ خطا:', error);
    process.exit(1);
  }
}

main();
