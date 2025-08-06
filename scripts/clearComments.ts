import { fetch } from "undici";

const CF_API_TOKEN = process.env.CF_API_TOKEN!;
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID!;
const CF_KV_NAMESPACE_ID = process.env.KV_NAMESPACE_ID!;

const kvBaseUrl = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}`;

async function clearAllCommentKeys() {
  const prefix = "comment-";
  let deleted = 0;

  const listRes = await fetch(`${kvBaseUrl}/keys?prefix=${prefix}&limit=1000`, {
    headers: {
      Authorization: `Bearer ${CF_API_TOKEN}`
    }
  });

  if (!listRes.ok) {
    const err = await listRes.text();
    throw new Error(`Failed to list keys: ${err}`);
  }

  const data = await listRes.json();
  const keys: { name: string }[] = data.result;

  if (keys.length === 0) {
    console.log("✅ No comment keys to delete.");
    return;
  }

  for (const { name } of keys) {
    const delRes = await fetch(`${kvBaseUrl}/values/${name}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`
      }
    });

    if (delRes.ok) {
      console.log(`🗑️ Deleted: ${name}`);
      deleted++;
    } else {
      console.warn(`❌ Failed to delete ${name}`);
    }
  }

  console.log(`\n✅ Finished. Total deleted: ${deleted}`);
}

clearAllCommentKeys().catch(err => {
  console.error("❌ Error clearing comments:", err.message);
  process.exit(1);
});
