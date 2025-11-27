// index.js – Minimal Dice bot (no webhook, no extra stuff)

const { Telegraf } = require('telegraf')

// 1) Your working token from BotFather (the one that /getMe proved is OK)
const BOT_TOKEN = "8596775901:AAEyy0RBLonGV-Qhdx09UsqzVe_xGwiGtmI";

console.log("Loaded BOT_TOKEN length:", BOT_TOKEN.length);
console.log("DEBUG getMe URL:", `https://api.telegram.org/bot${BOT_TOKEN}/getMe`);

// 2) Your mini-app URL
const WEB_APP_URL = "https://uncapitulating-persuadingly-elsie.ngrok-free.dev"

console.log("Loaded BOT_TOKEN length:", BOT_TOKEN.length)

if (!BOT_TOKEN || BOT_TOKEN.length < 30) {
  console.error("❌ BOT_TOKEN is invalid. Current value:", BOT_TOKEN)
  process.exit(1)
}
const https = require('https');

https.get(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Manual getMe result:', data);
  });
}).on('error', (err) => {
  console.error('HTTPS error:', err);
});

const bot = new Telegraf(BOT_TOKEN)

// Log every message so we know updates arrive
bot.on('message', (ctx, next) => {
  console.log('📩 Incoming message:', ctx.message)
  return next()
})

// /start command
bot.start((ctx) => {
  ctx.reply(
    'Welcome to 🎲 The Dice!\n\nTap the button below to open the game.',
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '🎲 Play The Dice',
              web_app: { url: WEB_APP_URL }
            }
          ]
        ]
      }
    }
  )
})

// /play command (same as /start)
bot.command('play', (ctx) => {
  ctx.reply(
    'Ready to roll? 🎲',
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '🎲 Open The Dice',
              web_app: { url: WEB_APP_URL }
            }
          ]
        ]
      }
    }
  )
})

// Launch with long polling only (no deleteWebhook)
bot.launch()
  .then(() => {
    console.log("✅ The Dice bot is running and listening for updates...")
  })
  .catch((err) => {
    console.error("❌ Error launching bot:", err)
  })

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
