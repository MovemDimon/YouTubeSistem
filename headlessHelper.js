export const setupHeadlessEnvironment = () => {
  // تنظیمات محیط برای GitHub Actions یا CI
  if (process.env.CI || process.env.GITHUB_ACTIONS) {
    console.log('⚙️ Configuring for headless environment (GitHub Actions)');
    return {
      headless: "new",
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--single-process',
        '--no-zygote',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--mute-audio',
        '--disable-audio-output',
        '--window-size=1920,1080'
      ],
      protocolTimeout: 180000
    };
  }
  
  // تنظیمات محیط برای اجرای محلی
  console.log('⚙️ Configuring for local environment');
  return {
    headless: false,
    args: [
      '--window-size=1920,1080'
    ],
    slowMo: 100
  };
};
