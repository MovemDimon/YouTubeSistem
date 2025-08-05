import { refreshAccessToken, postComment, postReply } from '../src/youtube';
import { fetch } from 'undici';

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

async function getStatus(GH_TOKEN: string): Promise<{ posted_comments: number }> {
  const res = await fetch("https://api.github.com/repos/MovemDimon/YouTubeSistem/contents/.status.json", {
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: "application/vnd.github.v3+json"
    }
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to fetch status: ${err}`);
  }

  const data = await res.json();
  const content = Buffer.from(data.content, "base64").toString();
  return JSON.parse(content);
}

async function getCurrentSha(GH_TOKEN: string, file: string): Promise<string | null> {
  const res = await fetch(`https://api.github.com/repos/MovemDimon/YouTubeSistem/contents/${file}`, {
    headers: { Authorization: `Bearer ${GH_TOKEN}` }
  });

  if (res.status === 404) return null;

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to get SHA for ${file}: ${err}`);
  }

  const json = await res.json();
  return json.sha;
}

async function updateStatus(GH_TOKEN: string, newCount: number) {
  const body = JSON.stringify({
    last_updated: new Date().toISOString(),
    total_comments: newCount
  }, null, 2);

  const sha = await getCurrentSha(GH_TOKEN, ".status.json");

  const res = await fetch("https://api.github.com/repos/MovemDimon/YouTubeSistem/contents/.status.json", {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: 'Update status',
      content: Buffer.from(body).toString('base64'),
      sha,
      branch: 'main'
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub status update failed: ${err}`);
  }

  console.log("✅ Status updated successfully");
}

async function updateHeartbeat(GH_TOKEN: string, videoId: string, lang: string, status: "sent" | "error") {
  const heartbeat = JSON.stringify({
    last_heartbeat: new Date().toISOString(),
    last_video: videoId,
    last_lang: lang,
    last_status: status
  }, null, 2);

  const res = await fetch("https://api.github.com/repos/MovemDimon/YouTubeSistem/contents/heartbeat.json", {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: 'Update heartbeat',
      content: Buffer.from(heartbeat).toString('base64'),
      sha: await getCurrentSha(GH_TOKEN, "heartbeat.json"),
      branch: 'main'
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub heartbeat update failed: ${err}`);
  }
}

async function main() {
  console.log('🚀 Starting comment processing...');

  const env = {
    CF_API_TOKEN: process.env.CF_API_TOKEN!,
    CF_ACCOUNT_ID: process.env.CF_ACCOUNT_ID!,
    CF_KV_NAMESPACE_ID: process.env.CF_KV_NAMESPACE_ID!,
    YOUTUBE_USERS: process.env.YOUTUBE_USERS!,
    GH_CONTENTS_TOKEN: process.env.GH_CONTENTS_TOKEN!,
  };

  const kvBaseUrl = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/storage/kv/namespaces/${env.CF_KV_NAMESPACE_ID}`;
  const listUrl = `${kvBaseUrl}/keys?prefix=comment-&limit=5`;

  const listRes = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` }
  });

  if (!listRes.ok) {
    const err = await listRes.text();
    throw new Error(`Failed to list KV keys: ${err}`);
  }

  const listData = await listRes.json() as any;
  const keys = listData.result;

  if (!keys || keys.length === 0) {
    throw new Error("No comment keys found in KV. Possibly populate system is broken.");
  }

  console.log(`🔍 Found ${keys.length} comments to process`);

  const usedMap = new Map<string, Set<string>>();
  let sentCount = 0;
  const accounts = JSON.parse(env.YOUTUBE_USERS);

  for (const key of keys) {
    const valueUrl = `${kvBaseUrl}/values/${key.name}`;
    const valueRes = await fetch(valueUrl, {
      headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` }
    });

    if (!valueRes.ok) {
      const err = await valueRes.text();
      throw new Error(`Failed to get value for ${key.name}: ${err}`);
    }

    const raw = await valueRes.text();
    const { videoId, lang, accountIndex } = JSON.parse(raw);
    const account = accounts[accountIndex];

    console.log(`▶️ Processing comment for video ${videoId} (${lang})`);

    try {
      const token = await refreshAccessToken(account);
      const commentLines = await fetchLines(`https://raw.githubusercontent.com/MovemDimon/YouTubeSistem/main/data/comments/${lang}.txt`);

      if (!usedMap.has(videoId)) {
        usedMap.set(videoId, new Set());
      }

      const usedSet = usedMap.get(videoId)!;
      const comment = pickUnique(videoId, commentLines, usedSet);
      const threadId = await postComment(token, videoId, comment);
      console.log(`💬 Comment posted: ${comment.substring(0, 30)}...`);

      const replyCount = Math.floor(Math.random() * 4);

      if (replyCount > 0) {
        const replies = await fetchLines(`https://raw.githubusercontent.com/MovemDimon/YouTubeSistem/main/data/replies/${lang}.txt`);
        const replyIndexes = shuffle([...Array(accounts.length).keys()].filter(i => i !== accountIndex)).slice(0, replyCount);

        for (const idx of replyIndexes) {
          const rToken = await refreshAccessToken(accounts[idx]);
          const reply = pickUnique(threadId, replies, new Set());
          await postReply(rToken, threadId, reply);
          console.log(`↪️ Reply posted: ${reply.substring(0, 30)}...`);
          await new Promise(r => setTimeout(r, 3000 + Math.random() * 4000));
        }
      }

      const deleteRes = await fetch(`${kvBaseUrl}/values/${key.name}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` }
      });

      if (!deleteRes.ok) {
        const err = await deleteRes.text();
        throw new Error(`Failed to delete ${key.name} from KV: ${err}`);
      }

      console.log(`🗑️ Deleted ${key.name} from KV`);
      await updateHeartbeat(env.GH_CONTENTS_TOKEN, videoId, lang, "sent");
      sentCount++;

    } catch (error) {
      console.error(`❌ Error processing ${key.name}:`, error);
      await updateHeartbeat(env.GH_CONTENTS_TOKEN, videoId, lang, "error");
      throw error;  // توقف کل سیستم در اولین خطا
    }
  }

  if (sentCount > 0) {
    const status = await getStatus(env.GH_CONTENTS_TOKEN);
    const newTotal = status.posted_comments + sentCount;
    await updateStatus(env.GH_CONTENTS_TOKEN, newTotal);
    console.log(`📈 Total comments sent: ${newTotal}`);
  } else {
    throw new Error("No comments were successfully processed.");
  }
}

main().catch(e => {
  console.error('❌ Unhandled error:', e);
  process.exit(1);
});
