import { ACCOUNTS } from "./youtube_cookies.js";
import { delay, shuffle, retryOperation, validateFile, getLangFromFilename } from "./utils.js";
import { searchAndStoreVideos } from "./searchAndStoreVideos.js";
import { postComment, likeComment, postReply } from "./youtubeActions.js";
import fs from "fs";
import { Octokit } from "@octokit/rest";

const MAX_COMMENTS = 10000;
const MAX_CONSECUTIVE_ERRORS = 5;
const MIN_VIDEOS_REQUIRED = 5;

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

  try {
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
  } catch (e) {
    console.error("⚠️ Failed to update GitHub status:", e.message);
  }
}

async function main() {
  console.log("🔍 Starting system check...");
  let consecutiveErrors = 0; // Added missing variable
  
  // Account validation
  console.log("🔐 Account Status:");
  const validAccounts = ACCOUNTS.filter(a => a.cookie);
  ACCOUNTS.forEach(acc => {
    console.log(`   ${acc.name}: ${acc.cookie ? '✅ Valid' : '❌ Invalid'}`);
  });

  if (validAccounts.length < 3) {
    throw new Error("❌ Need at least 3 valid accounts to proceed");
  }

  // Status check
  const status = loadStatus();
  if (status.posted_comments >= status.max_comments) {
    console.log("✅ Goal reached. Exiting.");
    return;
  }

  // Language selection
  const langs = fs.readdirSync("data/comments").filter(f => f.endsWith(".txt"));
  if (langs.length === 0) {
    throw new Error("❌ No comment files found in data/comments");
  }
  
  const lang = getLangFromFilename(shuffle(langs)[0]);
  console.log(`🌐 Selected language: ${lang}`);

  // Video management
  const videoPath = `data/videos/${lang}.json`;
  let videos = [];
  
  try {
    if (fs.existsSync(videoPath)) {
      videos = JSON.parse(fs.readFileSync(videoPath, "utf-8"));
      
      // Convert legacy videoId format to id
      if (videos.length > 0 && videos[0].videoId) {
        videos = videos.map(v => ({
          id: v.videoId,
          title: v.title,
          views: v.views
        }));
      }
      
      console.log(`📹 Loaded ${videos.length} existing videos`);
    }
  } catch (e) {
    console.warn("⚠️ Error loading videos:", e.message);
  }

  if (videos.length < MIN_VIDEOS_REQUIRED) {
    console.log("🔍 Not enough videos, starting search...");
    await searchAndStoreVideos();
    videos = JSON.parse(fs.readFileSync(videoPath, "utf-8"));
  }

  // Video selection
  const selected = shuffle(videos)
    .filter(v => v.id) // Filter invalid videos
    .slice(0, 2);
  let count = 0;

  // Main operations
  for (const [index, video] of selected.entries()) {
    const account = shuffle(validAccounts)[0];
    console.log(`\n🎬 Processing video: ${video.id} (${video.title.substring(0, 30)}...)`);

    try {
      // Post comment
      const commentText = shuffle(
        validateFile(`data/comments/${lang}.txt`).split("\n").filter(Boolean)
      )[0];
      
      const commentId = await retryOperation(
        () => postComment(account.cookie, video.id, commentText),
        "postComment",
        3
      );
      
      console.log(`💬 Comment by ${account.name}: ${commentText.substring(0, 30)}...`);
      count++;

      // Likes
      const likers = shuffle(validAccounts.filter(a => a !== account)).slice(0, 7);
      for (const acc of likers) {
        try {
          await retryOperation(
            () => likeComment(acc.cookie, commentId),
            "likeComment",
            2
          );
          await delay(1000 + Math.random() * 2000);
        } catch (e) {
          console.warn(`⚠️ Like failed for ${acc.name}:`, e.message);
        }
      }

      // Replies
      const replyCount = Math.floor(Math.random() * 4);
      const replies = shuffle(
        validateFile(`data/replies/${lang}.txt`).split("\n").filter(Boolean)
      );

      for (let i = 0; i < Math.min(replyCount, replies.length); i++) {
        const replier = shuffle(validAccounts.filter(a => a !== account))[0];
        try {
          await retryOperation(
            () => postReply(replier.cookie, commentId, replies[i]),
            "postReply",
            2
          );
          console.log(`↪️ Reply by ${replier.name}: ${replies[i].substring(0, 30)}...`);
          await delay(3000 + Math.random() * 4000);
        } catch (e) {
          console.warn(`⚠️ Reply failed for ${replier.name}:`, e.message);
        }
      }
    } catch (e) {
      console.error(`❌ Video processing failed:`, e.message);
      if (++consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.error("🚨 Emergency stop: Too many errors");
        break;
      }
    }

    // Delay between videos
    if (index < selected.length - 1) {
      const waitTime = 10000 + Math.random() * 10000;
      console.log(`⏳ Waiting ${Math.round(waitTime/1000)} seconds...`);
      await delay(waitTime);
    }
  }

  // Update status
  const newTotal = status.posted_comments + count;
  fs.writeFileSync("status.json", JSON.stringify({
    ...status,
    posted_comments: newTotal
  }, null, 2));

  if (process.env.GH_CONTENTS_TOKEN) {
    await updateStatusGitHub(process.env.GH_CONTENTS_TOKEN, newTotal);
    console.log("📡 GitHub status updated");
  }

  console.log(`\n🎉 Successfully processed ${count} videos. Total: ${newTotal}/${MAX_COMMENTS}`);
}

main().catch(e => console.error("🔥 Fatal error:", e));
