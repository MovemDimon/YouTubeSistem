import fetch from 'node-fetch';
import crypto from 'crypto';
import { delay } from './utils.js';

const YT_BASE = 'https://www.youtube.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

// تابع تولید SAPISIDHASH
function generateAuthHash(cookie) {
  const sapisid = cookie.match(/SAPISID=([^;]+)/)?.[1];
  if (!sapisid) throw new Error('SAPISID not found in cookie');
  const time = Math.floor(Date.now() / 1000);
  return crypto.createHash('sha1').update(`${time} ${sapisid} ${YT_BASE}`).digest('hex');
}

// استخراج client info و createCommentParams از HTML بدون jsdom
async function extractParams(videoId, cookie) {
  const res = await fetch(`${YT_BASE}/watch?v=${videoId}`, {
    headers: { 'User-Agent': USER_AGENT, 'Cookie': cookie }
  });
  const html = await res.text();

  // regex برای استخراج JSON داخل ytInitialData
  const match = html.match(/var ytInitialData = ({.+?});<\/script>/s) || html.match(/ytInitialData\s*=\s*({.+?});/s);
  if (!match) throw new Error('ytInitialData not found');

  const ytData = JSON.parse(match[1]);
  
  // clientVersion و API key از ytcfg
  const keyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
  const versionMatch = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/);
  const nameMatch = html.match(/"INNERTUBE_CLIENT_NAME":(\d+)/);

  return {
    apiKey: keyMatch ? keyMatch[1] : 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
    clientVersion: versionMatch ? versionMatch[1] : '2.20250810',
    clientName: nameMatch ? nameMatch[1] : '1',
    // ساخت createCommentParams داینامیک از continuation token
    createCommentParams: ytData?.contents?.twoColumnWatchNextResults?.results?.results?.contents?.[2]?.itemSectionRenderer?.contents?.[0]?.commentThreadRenderer?.comment?.commentRenderer?.contentText?.runs?.map(r => r.text).join('') || ''
  };
}

// ارسال کامنت بدون jsdom
export async function postComment(cookie, videoId, text) {
  try {
    if (!cookie || !videoId || !text) throw new Error('Missing required parameters');

    const { apiKey, clientVersion, clientName, createCommentParams } = await extractParams(videoId, cookie);
    const authHash = generateAuthHash(cookie);

    const body = {
      context: { client: { hl: 'en', gl: 'US', clientName, clientVersion } },
      commentText: text,
      createCommentParams
    };

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

    const apiUrl = `${YT_BASE}/youtubei/v1/comment/create_comment?key=${apiKey}&prettyPrint=false`;

    const res = await fetch(apiUrl, { method: 'POST', headers, body: JSON.stringify(body) });
    const data = await res.json();

    if (data.error) throw new Error(data.error.message || 'YouTube API error');
    return data.commentId || data.comment_id;
  } catch (err) {
    console.error('Error posting comment:', { videoId, error: err.message });
    throw err;
  }
}
