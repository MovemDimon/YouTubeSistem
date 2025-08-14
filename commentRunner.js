import { ACCOUNTS } from "./youtube_cookies.js";
import { delay, shuffle, retryOperation, validateFile } from "./utils.js";
import { searchAndStoreVideos } from "./searchAndStoreVideos.js";
import { postComment, likeComment, postReply } from "./youtubeActions.js";
import fs from "fs";
import path from "path";
import { Octokit } from "@octokit/rest";

const MAX_COMMENTS = 10000;
const MAX_CONSECUTIVE_ERRORS = 5;

function loadStatus() {
  try {
    const status = JSON.parse(fs.readFileSync("status.json", "utf-8"));
    return {
      posted_comments: status.posted_comments || 0,
      max_comments: status.max_comments || MAX_COMMENTS
    };
  } catch (e) {
    return { posted_comments: 0, max_comments: MAX_COMMENTS };
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
  
  const newStatus = {
    posted_comments: postedCount,
    max_comments: MAX_COMMENTS,
    last_updated: new Date().toISOString()
  };
  
  const content = Buffer.from(JSON.stringify(newStatus, null, 2)).toString("base64");

  await octokit.repos.createOrUpdateFileContents({
    ...repo,
    message: `Update status to ${postedCount}`,
    content,
    sha,
  });
}

async function main() {
  const status = loadStatus();
  if (status.posted_comments >= status.max_comments) {
    console.log("✅ Goal reached. Exiting.");
    return;
  }

  let consecutiveErrors = 0;
  const langs = fs.readdirSync("data/comments").filter(f => f.endsWith(".txt"));
  
  if (langs.length === 0) {
    throw new Error("No comment files found in data/comments");
  }
  
  const lang = getLangFromFilename(shuffle(langs)[0]);

  const videoPath = `data/videos/${lang}.json`;
  if (!fs.existsSync(videoPath)) {
    console.log("📹 No videos found. Searching...");
    await searchAndStoreVideos();
  }

  const videos = JSON.parse(validateFile(videoPath));
  const selected = shuffle(videos).slice(0, 2);

  let count = 0;

  for (const [index, video] of selected.entries()) {
    const account = shuffle(ACCOUNTS.filter(a => a.cookie))[0];
    
    if (!account) {
      console.error("❌ No valid accounts available");
      break;
    }

    try {
      const commentText = shuffle(
        validateFile(`data/comments/${lang}.txt`).split("\n").filter(Boolean)
      )[0];

      const commentId = await retryOperation(
        () => postComment(account.cookie, video.id, commentText),
        "postComment",
        3
      );
      
      console.log(`💬 Comment posted by ${account.name}: ${commentText.substring(0, 30)}...`);
      count++;
      consecutiveErrors = 0;

      // لایک کردن کامنت با حساب‌های دیگر
      const likers = shuffle(ACCOUNTS.filter(a => a.cookie && a !== account)).slice(0, 7);
      for (const acc of likers) {
        try {
          await retryOperation(
            () => likeComment(acc.cookie, commentId),
            "likeComment",
            2
          );
          await delay(1000 + Math.random() * 3000);
        } catch (e) {
          console.warn(`⚠️ Like failed for ${acc.name}: ${e.message}`);
        }
      }

      // ارسال پاسخ‌ها
      const replyCount = Math.floor(Math.random() * 4);
      const replies = shuffle(
        validateFile(`data/replies/${lang}.txt`).split("\n").filter(Boolean)
      );

      for (let i = 0; i < Math.min(replyCount, replies.length); i++) {
        const replier = shuffle(ACCOUNTS.filter(a => a.cookie && a !== account))[0];
        if (!replier) continue;

        try {
          await retryOperation(
            () => postReply(replier.cookie, commentId, replies[i]),
            "postReply",
            2
          );
          console.log(`↪️ Reply by ${replier.name}: ${replies[i].substring(0, 30)}...`);
          await delay(3000 + Math.random() * 5000);
        } catch (e) {
          console.warn(`⚠️ Reply failed for ${replier.name}: ${e.message}`);
        }
      }
    } catch (e) {
      consecutiveErrors++;
      console.error(`❌ Critical error: ${e.message}`);
      
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.error("🚨 Emergency stop: Too many consecutive errors");
        break;
      }
    }

    // تاخیر بین ویدیوهای مختلف
    if (index < selected.length - 1) {
      await delay(15000 + Math.random() * 15000);
    }
  }

  const newTotal = status.posted_comments + count;
  fs.writeFileSync("status.json", JSON.stringify({
    ...status,
    posted_comments: newTotal
  }, null, 2));

  if (process.env.GH_CONTENTS_TOKEN) {
    await updateStatusGitHub(process.env.GH_CONTENTS_TOKEN, newTotal);
    console.log("📡 GitHub status updated");
  }
}

main().catch(e => console.error("🔥 Fatal error in main:", e));
