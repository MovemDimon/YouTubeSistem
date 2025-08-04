// src/producer.ts
import { Queue } from '@cloudflare/workers-types';
import keywords_en from '../data/keywords/en.json';
import keywords_fa from '../data/keywords/fa.json';
import keywords_ru from '../data/keywords/ru.json';
import keywords_es from '../data/keywords/es.json';
import keywords_hi from '../data/keywords/hi.json';

type Lang = 'en' | 'fa' | 'ru' | 'es' | 'hi';
type Message = { platform: 'youtube'; videoId: string; lang: Lang; accountIndex: number };

const WEIGHTS: Record<Lang, number> = { en: 0.40, ru: 0.20, es: 0.15, hi: 0.20, fa: 0.05 };
const MAX_COMMENTS_PER_VIDEO = 7;

async function fetchYouTubeVideos(lang: string, keywords: string[], apiKey: string): Promise<string[]> {
  const videoIds = new Set<string>();

  for (const keyword of keywords) {
    let nextPageToken = '';
    let fetched = 0;
    const maxPerKeyword = 100;

    while (fetched < maxPerKeyword) {
      const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=50&q=${encodeURIComponent(keyword)}&relevanceLanguage=${lang}&key=${apiKey}&pageToken=${nextPageToken}`;
      const res = await fetch(url);
      if (!res.ok) break;
      const json = await res.json();

      for (const item of json.items || []) {
        const vid = item.id?.videoId;
        if (vid && !videoIds.has(vid)) {
          videoIds.add(vid);
          fetched++;
        }
        if (fetched >= maxPerKeyword) break;
      }

      nextPageToken = json.nextPageToken;
      if (!nextPageToken) break;
    }
  }

  return Array.from(videoIds);
}

export default {
  async fetchAndProduce(queue: Queue, env: any) {
    const langs: Lang[] = ['en','fa','ru','es','hi'];
    const keywordsMap = { en: keywords_en, fa: keywords_fa, ru: keywords_ru, es: keywords_es, hi: keywords_hi };
    const apiKey = env.YOUTUBE_API_KEY;
    const accountsCount = JSON.parse(env.YOUTUBE_USERS).length;

    const totalTarget = 10000; // کل تعداد کامنت
    let produced = 0;

    for (const lang of langs) {
      const videoIds = await fetchYouTubeVideos(lang, keywordsMap[lang], apiKey);
      const selected = videoIds; // همه ویدیوها بدون محدودیت

      for (const videoId of selected) {
        const accountIndexes = Array.from({ length: accountsCount }, (_, i) => i)
          .sort(() => Math.random() - 0.5)
          .slice(0, MAX_COMMENTS_PER_VIDEO);

        for (const idx of accountIndexes) {
          if (produced >= totalTarget) return;
          await queue.send({ platform: 'youtube', videoId, lang, accountIndex: idx });
          produced++;

          // تأخیر انسانی بین 1.5 تا 3 ثانیه
          await new Promise(r => setTimeout(r, 1500 + Math.random() * 1500));
        }
      }
    }
  }
};
