import { refreshAccessToken } from "./youtube";

export async function getActiveUsers() {
  const raw = process.env.YOUTUBE_USERS;

  if (!raw) {
    throw new Error("❌ Missing YOUTUBE_USERS environment variable");
  }

  let users;
  try {
    users = JSON.parse(raw);
  } catch (e) {
    throw new Error("❌ Failed to parse YOUTUBE_USERS JSON from environment");
  }

  const activeUsers = [];

  for (const user of users) {
    try {
      const tokens = await refreshAccessToken(user.refresh_token, user.client_id, user.client_secret);
      activeUsers.push({
        ...user,
        access_token: tokens.access_token,
      });
    } catch (error: any) {
      const msg = error?.response?.data?.error_description || error.message;
      if (msg?.includes("invalid_grant")) {
        console.warn(`⚠️ Skipping invalid token for ${user.name}`);
      } else {
        console.error(`❌ Unexpected error with ${user.name}:`, error);
      }
      continue;
    }
  }

  if (activeUsers.length === 0) {
    throw new Error("🚨 No valid YouTube users found!");
  }

  console.log(`✅ ${activeUsers.length} valid users available.`);
  return activeUsers;
}
