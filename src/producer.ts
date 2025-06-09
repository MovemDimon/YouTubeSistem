import { Queue } from '@cloudflare/workers-types';
import keywords_en from '../data/keywords/en.json';
import keywords_fa from '../data/keywords/fa.json';
import keywords_ru from '../data/keywords/ru.json';
import keywords_es from '../data/keywords/es.json';
import keywords_hi from '../data/keywords/hi.json';

type Message = {
  platform: 'youtube';
  videoId: string;
  lang: 'en' | 'fa' | 'ru' | 'es' | 'hi';
  accountIndex: number;
};

// درصد توزیع
const WEIGHTS: Record<Message['lang'], number> = {
  en: 0.40,
  ru: 0.20,
  es: 0.15,
  hi: 0.20,
  fa: 0.05,
};

async function fetchYouTubeVideos(
  lang: string,
  keywords: string[],
  apiKey: string
): Promise<string[]> {
  const videoIds = new Set<string>();
  for (const keyword of keywords) {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=5`
              + `&q=${encodeURIComponent(keyword)}&relevanceLanguage=${lang}&key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) continue;
    const data = await res.json();
    for (const item of data.items || []) {
      if (item.id?.videoId) videoIds.add(item.id.videoId);
    }
  }
  return Array.from(videoIds);
}

export default {
  async fetchAndProduce(queue: Queue, env: any) {
    const langs: Message['lang'][] = ['en','fa','ru','es','hi'];
    const keywordsMap = { en: keywords_en, fa: keywords_fa, ru: keywords_ru, es: keywords_es, hi: keywords_hi };
    const apiKey = env.YOUTUBE_API_KEY;
    const totalComments = parseInt(env.TOTAL_COMMENTS, 10);
    const accountsCount = JSON.parse(env.YOUTUBE_USERS).length;

    for (const lang of langs) {
      // تعداد کل کامنت برای این زبان
      const target = Math.floor(totalComments * WEIGHTS[lang]);
      // هر ویدیو چند کامنت (به ازای هر اکانت)
      const perVideo = accountsCount;
      const videosNeeded = Math.ceil(target / perVideo);

      const videoIds = await fetchYouTubeVideos(lang, keywordsMap[lang], apiKey);
      const selected = videoIds.slice(0, videosNeeded);

      for (const videoId of selected) {
        for (let idx = 0; idx < accountsCount; idx++) {
          await queue.send({
            platform: 'youtube',
            videoId,
            lang,
            accountIndex: idx,
          });
        }
      }
    }
  }
};
