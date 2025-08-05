import { refreshAccessToken } from "./youtube";

type YouTubeUser = {
  client_id: string;
  client_secret: string;
  refresh_token: string;
};

export async function getActiveUsers(): Promise<YouTubeUser[]> {
  const raw = process.env.YOUTUBE_USERS!;
  const users: YouTubeUser[] = JSON.parse(raw);

  const validUsers: YouTubeUser[] = [];

  console.log(`🔍 Verifying ${users.length} YouTube accounts...\n`);

  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    const label = `User ${i}`;

    if (!user.client_id || !user.client_secret || !user.refresh_token) {
      console.warn(`⚠️ ${label} skipped due to missing fields.`);
      continue;
    }

    try {
      await refreshAccessToken(user); // مهم: await اضافه شد!
      console.log(`✅ ${label} passed token refresh.`);
      validUsers.push(user);
    } catch (e: any) {
      console.error(`❌ ${label} failed: ${e?.message || e}`);
    }
  }

  if (validUsers.length === 0) {
    throw new Error("🚨 No valid YouTube accounts found! Aborting.");
  }

  console.log(`\n📋 ${validUsers.length} of ${users.length} users are valid.`);
  return validUsers;
}
