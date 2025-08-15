import fetch from 'node-fetch';
import crypto from 'crypto';
import { JSDOM } from 'jsdom';
import { delay } from './utils.js';

const YT_BASE = 'https://www.youtube.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

// تابع تولید SAPISIDHASH
function generateAuthHash(cookie) {
  const sapisid = cookie.match(/SAPISID=([^;]+)/)?.[1];
  if (!sapisid) throw new Error('SAPISID not found in cookie');
  
  const time = Math.floor(Date.now() / 1000);
  return crypto.createHash('sha1')
    .update(`${time} ${sapisid} ${YT_BASE}`)
    .digest('hex');
}

// تابع استخراج پارامترها از صفحه ویدیو
async function extractPageParams(videoId, cookie) {
  try {
    const response = await fetch(`${YT_BASE}/watch?v=${videoId}`, {
      headers: {
        'Cookie': cookie,
        'User-Agent': USER_AGENT
      }
    });
    
    const html = await response.text();
    const dom = new JSDOM(html);
    const scripts = dom.window.document.querySelectorAll('script');
    
    let clientVersion = '2.20250810';
    let apiKey = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
    let clientName = 'WEB';
    
    // جستجو در اسکریپت‌ها برای یافتن پارامترها
    for (const script of scripts) {
      if (script.innerHTML.includes('INNERTUBE_CLIENT_VERSION')) {
        const match = script.innerHTML.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/);
        if (match) clientVersion = match[1];
        
        const keyMatch = script.innerHTML.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
        if (keyMatch) apiKey = keyMatch[1];
        
        const nameMatch = script.innerHTML.match(/"INNERTUBE_CLIENT_NAME":(\d+)/);
        if (nameMatch) clientName = nameMatch[1];
      }
    }
    
    return {
      clientVersion,
      apiKey,
      clientName
    };
    
  } catch (error) {
    console.error('Error extracting page params:', error.message);
    return {
      clientVersion: '2.20250810',
      apiKey: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
      clientName: '1'
    };
  }
}

// ساخت createCommentParams شبیه مرورگر
function buildCreateCommentParams(videoId) {
  const params = {
    videoId: videoId,
    serializedComment: null,
    params: {
      index: 0,
      page: "watch",
      target: "watch-discussion"
    }
  };
  
  return Buffer.from(JSON.stringify(params)).toString('base64');
}

// ارسال کامنت (نسخه نهایی Plan B)
export async function postComment(cookie, videoId, text) {
  try {
    // اعتبارسنجی پارامترها
    if (!cookie || !videoId || !text) {
      throw new Error('Missing required parameters');
    }

    // استخراج پارامترهای داینامیک
    const { clientVersion, apiKey, clientName } = await extractPageParams(videoId, cookie);
    const authHash = generateAuthHash(cookie);
    const createCommentParams = buildCreateCommentParams(videoId);

    // ساختار بدنه درخواست
    const body = {
      context: {
        client: {
          hl: 'en',
          gl: 'US',
          clientName: clientName,
          clientVersion: clientVersion
        }
      },
      commentText: text,
      createCommentParams: createCommentParams
    };

    // هدرهای کامل
    const headers = {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/json',
      'Authorization': `SAPISIDHASH ${Math.floor(Date.now() / 1000)}_${authHash}`,
      'Cookie': cookie,
      'Origin': YT_BASE,
      'Referer': `${YT_BASE}/watch?v=${videoId}`,
      'X-Origin': YT_BASE,
      'X-Youtube-Client-Name': clientName,
      'X-Youtube-Client-Version': clientVersion,
      'X-Goog-AuthUser': '0',
      'X-Goog-PageId': Math.floor(Math.random() * 1000000000).toString()
    };

    // URL با API Key داینامیک
    const apiUrl = `${YT_BASE}/youtubei/v1/comment/create_comment?key=${apiKey}&prettyPrint=false`;

    // ارسال درخواست
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
    });

    // پردازش پاسخ
    const data = await response.json();
    
    if (data.error) {
      console.error('YouTube API Error:', {
        code: data.error.code,
        message: data.error.message,
        status: response.status,
        endpoint: apiUrl
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

// توابع likeComment و postReply (کوتاه شده برای تمرکز)
export async function likeComment(cookie, commentId) {
  // پیاده‌سازی مشابه با استخراج پارامترها
}

export async function postReply(cookie, commentId, text) {
  // پیاده‌سازی مشابه با استخراج پارامترها
} 
