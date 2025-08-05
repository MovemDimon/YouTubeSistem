import { fetch } from 'undici';

async function main() {
  console.log('🔍 Verifying system status...');
  
  const GH_TOKEN = process.env.GH_CONTENTS_TOKEN!;
  const repo = "MovemDimon/YouTubeSistem";
  
  // دریافت آخرین وضعیت
  const statusRes = await fetch(`https://api.github.com/repos/${repo}/contents/.status.json`, {
    headers: { Authorization: `Bearer ${GH_TOKEN}` }
  });
  
  if (!statusRes.ok) {
    console.error('❌ Failed to fetch status:', await statusRes.text());
    process.exit(1);
  }
  
  const statusData = await statusRes.json();
  const statusContent = Buffer.from(statusData.content, "base64").toString();
  const status = JSON.parse(statusContent);
  
  // دریافت تاریخچه commit
  const commitsRes = await fetch(`https://api.github.com/repos/${repo}/commits?path=.status.json&per_page=1`, {
    headers: { Authorization: `Bearer ${GH_TOKEN}` }
  });
  
  if (!commitsRes.ok) {
    console.error('❌ Failed to fetch commits:', await commitsRes.text());
    process.exit(1);
  }
  
  const [commit] = await commitsRes.json();
  const commitDate = new Date(commit.commit.committer.date);
  const now = new Date();
  const diffMinutes = (now.getTime() - commitDate.getTime()) / 60000;
  
  if (diffMinutes > 10) {
    throw new Error(`Status file not updated in ${Math.floor(diffMinutes)} minutes`);
  }
  
  console.log(`✅ Status updated ${Math.floor(diffMinutes)} minutes ago (Total: ${status.total_comments})`);
}

main().catch(e => {
  console.error('❌ Verification failed:', e);
  process.exit(1);
});
