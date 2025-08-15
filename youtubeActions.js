import fetch from 'node-fetch';
import crypto from 'crypto';
import { delay } from './utils.js';

// تنظیمات پایه
const YOUTUBE_API_URL = 'https://www.youtube.com/youtubei/v1';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0';

// تابع تولید SAPISIDHASH
function generateAuthHash(cookie) {
  const sapisid = cookie.match(/SAPISID=([^;]+)/)?.[1];
  if (!sapisid) throw new Error('SAPISID not found in cookie');
  
  const time = Math.floor(Date.now() / 1000);
  return crypto.createHash('sha1')
    .update(`${time} ${sapisid} https://www.youtube.com`)
    .digest('hex');
}

// هدرهای مشترک
const COMMON_HEADERS = {
  'User-Agent': USER_AGENT,
  'X-Origin': 'https://www.youtube.com',
  'X-Youtube-Client-Name': '1',
  'X-Youtube-Client-Version': '2.20240610',
  'Content-Type': 'application/json',
  'Accept': '*/*',
  'Origin': 'https://www.youtube.com',
  'Referer': 'https://www.youtube.com',
  'X-Goog-AuthUser': '0'
};

// تابع اصلی برای ارسال کامنت
export async function postComment(cookie, videoId, text) {
  try {
    // اعتبارسنجی پارامترها
    if (!videoId || !text || !cookie) {
      throw new Error('Missing required parameters');
    }

    const authHash = generateAuthHash(cookie);
    const currentTime = Math.floor(Date.now() / 1000);

    const response = await fetch(`${YOUTUBE_API_URL}/comment/create_comment`, {
      method: 'POST',
      headers: {
        ...COMMON_HEADERS,
        'Authorization': `SAPISIDHASH ${currentTime}_${authHash}`,
        'Cookie': cookie,
        'Referer': `https://www.youtube.com/watch?v=${videoId}`,
        'X-Goog-PageId': Math.floor(Math.random() * 1000000000).toString()
      },
      body: JSON.stringify({
        commentText: text,
        videoId: videoId,
        context: {
          client: {
            hl: 'en',
            gl: 'US',
            clientName: 'WEB',
            clientVersion: '2.20240610',
            originalUrl: `https://www.youtube.com/watch?v=${videoId}`,
            mainAppWebInfo: {
              graftUrl: `/watch?v=${videoId}`,
              webDisplayMode: "WEB_DISPLAY_MODE_BROWSER"
            }
          },
          user: {
            lockedSafetyMode: false
          },
          request: {
            useSsl: true,
            internalExperimentFlags: []
          }
        }
      })
    });

    // بررسی پاسخ
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After') || 60;
      throw new Error(`Rate limited. Retry after ${retryAfter} seconds`);
    }

    const data = await response.json();
    
    if (data.error) {
      console.error('YouTube API Error:', {
        code: data.error.code,
        message: data.error.message,
        status: response.status
      });
      throw new Error(data.error.message || 'YouTube API error');
    }

    return data.commentId || data.comment_id;

  } catch (error) {
    console.error('Error posting comment:', {
      videoId,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

// تابع برای لایک کامنت
export async function likeComment(cookie, commentId) {
  try {
    if (!commentId || !cookie) {
      throw new Error('Missing required parameters');
    }

    const authHash = generateAuthHash(cookie);
    const currentTime = Math.floor(Date.now() / 1000);

    const response = await fetch(`${YOUTUBE_API_URL}/comment/like_comment`, {
      method: 'POST',
      headers: {
        ...COMMON_HEADERS,
        'Authorization': `SAPISIDHASH ${currentTime}_${authHash}`,
        'Cookie': cookie
      },
      body: JSON.stringify({
        commentId: commentId,
        context: {
          client: {
            hl: 'en',
            gl: 'US',
            clientName: 'WEB',
            clientVersion: '2.20240610'
          }
        }
      })
    });

    const data = await response.json();
    return data.success;

  } catch (error) {
    console.error('Error liking comment:', {
      commentId,
      error: error.message
    });
    throw error;
  }
}

// تابع برای ارسال پاسخ
export async function postReply(cookie, commentId, text) {
  try {
    if (!commentId || !text || !cookie) {
      throw new Error('Missing required parameters');
    }

    const authHash = generateAuthHash(cookie);
    const currentTime = Math.floor(Date.now() / 1000);

    const response = await fetch(`${YOUTUBE_API_URL}/comment/create_comment_reply`, {
      method: 'POST',
      headers: {
        ...COMMON_HEADERS,
        'Authorization': `SAPISIDHASH ${currentTime}_${authHash}`,
        'Cookie': cookie
      },
      body: JSON.stringify({
        commentId: commentId,
        commentText: text,
        context: {
          client: {
            hl: 'en',
            gl: 'US',
            clientName: 'WEB',
            clientVersion: '2.20240610'
          }
        }
      })
    });

    const data = await response.json();
    return data.commentId || data.comment_id;

  } catch (error) {
    console.error('Error posting reply:', {
      commentId,
      error: error.message
    });
    throw error;
  }
} 
