import { ACCOUNTS } from "./youtube_cookies.js";
import { delay, shuffle, getLangFromFilename } from "./utils.js";
import { searchAndStoreVideos } from "./searchAndStoreVideos.js";
import { postComment, likeComment, postReply } from "./youtubeActions.js";
import fs from "fs";
import path from "path";
import { Octokit } from "@octokit/rest";

const MAX_COMMENTS = 10000;

function loadStatus() {
  try {
    return JSON.parse(fs.readFileSync("status.json", "utf-8"));
  } catch {
    return { posted: 0 };
  }
}

async function updateStatusGitHub(GH_TOKEN, postedCount) {
  const octokit = new Octokit({ auth: GH_TOKEN });
  const repo = {
    owner: "MovemDimon",
    repo: "YouTubeSistem",
    path: "status.json",
  };

  const { data } = await octokit.repos.getContent({ ...repo });
  const sha = data.sha;
  const content = Buffer.from(
    JSON.stringify({ posted: postedCount }, null, 2)
  ).toString("base64");

  await octokit.repos.createOrUpdateFileContents({
    ...repo,
    message: `Update status to ${postedCount}`,
    content,
    sha,
  });
}

async function main() {
  const status = loadStatus();
  if (status.posted >= MAX_COMMENTS) {
    console.log("✅ Goal reached. Exiting.");
    return;
  }

  const langs = fs.readdirSync("data/comments").filter(f => f.endsWith(".txt"));
  const lang = getLangFromFilename(shuffle(langs)[0]);

  const videoPath = `data/videos/${lang}.json`;
  if (!fs.existsSync(videoPath)) {
    console.log("📹 No videos yet. Searching...");
    await searchAndStoreVideos();
  }

  const videos = JSON.parse(fs.readFileSync(videoPath, "utf-8"));
  const selected = shuffle(videos).slice(0, 2);

  let count = 0;

  for (const video of selected) {
    const account = shuffle(ACCOUNTS)[0];
    const commentText = shuffle(
      fs.readFileSync(`data/comments/${lang}.txt`, "utf-8")
        .split("\n")
        .filter(Boolean)
    )[0];

    try {
      const commentId = await postComment(account.cookie, video.id, commentText);
      console.log("💬 Comment posted:", commentText);
      count++;

      const likers = shuffle(ACCOUNTS).slice(0, 7);
      for (const acc of likers) {
        try {
          await likeComment(acc.cookie, commentId);
          await delay(500 + Math.random() * 1500);
        } catch (e) {
          console.warn("⚠️ Like failed", e.message);
        }
      }

      const replyCount = Math.floor(Math.random() * 4);
      const replies = shuffle(
        fs.readFileSync(`data/replies/${lang}.txt`, "utf-8")
          .split("\n")
          .filter(Boolean)
      );

      for (let i = 0; i < replyCount; i++) {
        const replier = shuffle(ACCOUNTS.filter(a => a !== account))[0];
        try {
          await postReply(replier.cookie, commentId, replies[i]);
          console.log("↪️ Reply:", replies[i]);
          await delay(2000 + Math.random() * 2000);
        } catch (e) {
          console.warn("⚠️ Reply failed", e.message);
        }
      }
    } catch (e) {
      console.error("❌ Comment failed", e.message);
    }
  }

  const newTotal = status.posted + count;
  fs.writeFileSync("status.json", JSON.stringify({ posted: newTotal }, null, 2));

  if (process.env.GH_CONTENTS_TOKEN) {
    await updateStatusGitHub(process.env.GH_CONTENTS_TOKEN, newTotal);
    console.log("📡 GitHub status updated");
  }
}

main();
