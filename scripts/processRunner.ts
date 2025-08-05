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
    console.error('Failed to fetch status:', await res.text());
    return { posted_comments: 0 };
  }

  const data = await res.json();
  const content = Buffer.from(data.content, "base64").toString();
  return JSON.parse(content);
}

async function getCurrentSha(GH_TOKEN: string, file: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/MovemDimon/YouTubeSistem/contents/${file}`, {
      headers: { 'Authorization': `Bearer ${GH_TOKEN}` }
    });
    
    if (res.status === 404) return null;
    
    const json = await res.json();
    return json.sha;
  } catch (error) {
    console.error(`Error getting SHA for ${file}:`, error);
    return null;
  }
}

async function updateStatus(GH_TOKEN: string, newCount: number) {
  const body = JSON.stringify({
    last_updated: new Date().toISOString(),
    total_comments: newCount
  }, null, 2);

  const sha = await getCurrentSha(GH_TOKEN, ".status.json");
  
  const res = await fetch(`https://api.github.com/repos/MovemDimon/YouTubeSistem/contents/.status.json`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${GH_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: 'Update status',
      content: Buffer.from(body).toString('base64'),
      sha: sha,
      branch: 'main'
    })
  });

  if (!res.ok) {
    console.error("❌ GitHub status update failed:", await res.text());
  } else {
    console.log("✅ Status updated successfully");
  }
}

async function updateHeartbeat(GH_TOKEN: string, videoId: string, lang: string, status: "sent" | "error") {
  const heartbeat = JSON.stringify({
    last_heartbeat: new Date().toISOString(),
    last_video: videoId,
    last_lang: lang,
    last_status: status
  }, null, 2);

  const res = await fetch(`https://api.github.com/repos/MovemDimon/YouTubeSistem/contents/heartbeat.json`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${GH_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: 'Update heartbeat',
      content: Buffer.from(heartbeat).toString('base64'),
      sha: await getCurrentSha(GH_TOKEN, "heartbeat.json"),
      branch: 'main'
    })
  });

  if (!res.ok) console.error("❌ GitHub heartbeat update failed:", await res.text());
}

async function main() {
  console.log('🚀 Starting comment processing...');
  
  // خواندن متغیرهای محیطی
  const env = {
    CF_API_TOKEN: process.env.CF_API_TOKEN!,
    CF_ACCOUNT_ID: process.env.CF_ACCOUNT_ID!,
    CF_KV_NAMESPACE_ID: process.env.CF_KV_NAMESPACE_ID!,
    YOUTUBE_USERS: process.env.YOUTUBE_USERS!,
    GH_CONTENTS_TOKEN: process.env.GH_CONTENTS_TOKEN!,
  };

  // URL پایه برای دسترسی به KV
  const kvBaseUrl = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/storage/kv/namespaces/${env.KV_NAMESPACE_ID}`;
  
  // دریافت لیست کامنت‌ها از KV
  const listUrl = `${kvBaseUrl}/keys?prefix=comment-&limit=10`;
  const listRes = await fetch(listUrl, {
    headers: { 'Authorization': `Bearer ${env.CF_API_TOKEN}` }
  });
  
  if (!listRes.ok) {
    console.error('❌ Failed to list KV keys:', await listRes.text());
    return;
  }
  
  const listData = await listRes.json() as any;
  const keys = listData.result;
  const usedMap = new Map<string, Set<string>>();
  let sentCount = 0;

  console.log(`🔍 Found ${keys.length} comments to process`);
  
  for (const key of keys) {
    const valueUrl = `${kvBaseUrl}/values/${key.name}`;
    const valueRes = await fetch(valueUrl, {
      headers: { 'Authorization': `Bearer ${env.CF_API_TOKEN}` }
    });
    
    if (!valueRes.ok) {
      console.error(`❌ Failed to get value for ${key.name}:`, await valueRes.text());
      continue;
    }
    
    const raw = await valueRes.text();
    const { videoId, lang, accountIndex } = JSON.parse(raw);
    const accounts = JSON.parse(env.YOUTUBE_USERS);
    const account = accounts[accountIndex];

    console.log(`▶️ Processing comment for video ${videoId} (${lang})`);
    
    try {
      // دریافت توکن دسترسی
      const token = await refreshAccessToken(account);
      
      // انتخاب کامنت تصادفی
      const commentLines = await fetchLines(`https://raw.githubusercontent.com/MovemDimon/YouTubeSistem/main/data/comments/${lang}.txt`);
      
      if (!usedMap.has(videoId)) {
        usedMap.set(videoId, new Set());
      }
      const usedSet = usedMap.get(videoId)!;
      
      const comment = pickUnique(videoId, commentLines, usedSet);
      const threadId = await postComment(token, videoId, comment);
      console.log(`💬 Comment posted: ${comment.substring(0, 30)}...`);
      
      // ارسال پاسخ‌ها
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
      
      // حذف کامنت از KV
      const deleteRes = await fetch(`${kvBaseUrl}/values/${key.name}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${env.CF_API_TOKEN}` }
      });
      
      if (!deleteRes.ok) {
        console.error(`❌ Failed to delete ${key.name}:`, await deleteRes.text());
      } else {
        console.log(`🗑️ Deleted ${key.name} from KV`);
      }
      
      // به‌روزرسانی وضعیت
      await updateHeartbeat(env.GH_CONTENTS_TOKEN, videoId, lang, "sent");
      sentCount++;
      
    } catch (error) {
      console.error(`❌ Error processing ${key.name}:`, error);
      await updateHeartbeat(env.GH_CONTENTS_TOKEN, videoId, lang, "error");
    }
  }
  
  // به‌روزرسانی وضعیت کلی
  if (sentCount > 0) {
    const status = await getStatus(env.GH_CONTENTS_TOKEN);
    const newTotal = status.posted_comments + sentCount;
    await updateStatus(env.GH_CONTENTS_TOKEN, newTotal);
    console.log(`📈 Total comments sent: ${newTotal}`);
  } else {
    console.log('ℹ️ No comments processed');
  }
}

main().catch(e => {
  console.error('❌ Unhandled error:', e);
  process.exit(1);
});
