import users from "./youtube-users.json";
import { refreshAccessToken } from "./youtube";

export async function getActiveUsers() {
  const activeUsers = [];

  for (const user of users) {
    try {
      const tokens = await refreshAccessToken(user.refresh_token);
      // اگر به اینجا رسید یعنی توکن سالمه
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
      continue; // رد شو به کاربر بعدی
    }
  }

  if (activeUsers.length === 0) {
    throw new Error("🚨 No valid YouTube users found!");
  }

  console.log(`✅ ${activeUsers.length} valid users available.`);
  return activeUsers;
}
