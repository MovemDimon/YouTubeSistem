import { refreshAccessToken } from "./youtube";

console.log("YOUTUBE_USERS ENV:", process.env.YOUTUBE_USERS);
export async function getActiveUsers(): Promise<any[]> {
  const users = JSON.parse(process.env.YOUTUBE_USERS!);
  const validUsers = [];

  console.log(`🔍 Verifying ${users.length} YouTube accounts...\n`);

  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    try {
      await refreshAccessToken(user);
      console.log(`✅ User ${i} is valid and token works.`);
      validUsers.push(user);
    } catch (error: any) {
      const message = typeof error === 'string'
        ? error
        : error?.response?.data
        || error?.message
        || error;

      console.log(`❌ User ${i} failed:`, JSON.stringify(message, null, 2));
    }
  }

  if (validUsers.length === 0) {
    throw new Error("🚨 No valid YouTube accounts found! Aborting.");
  }

  return validUsers;
}
