import express from "express";
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import Stripe from "stripe";
import { GoogleGenerativeAI } from "@google/generative-ai";
import axios from "axios";
import path from "path";
import { fileURLToPath } from 'url';
import mongoose from "mongoose";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// ================= ADMIN CONFIGURATION =================
const ADMIN_IDS = ["7154361039"];

// ================= OWNER/DEVELOPER CONFIGURATION =================
const OWNER = {
  name: "Muhammad Ilyas",
  username: "@KING_OF_ALPHA",
  telegram: "https://t.me/KING_OF_ALPHA",
  github: "https://github.com/mamme234",
  email: "ghazimuhammadilyas@gmail.com",
  bio: "Full-Stack Developer | AI Enthusiast | Bot Creator",
  skills: ["JavaScript", "Python", "AI/ML", "Web Development", "Bot Development"],
  achievements: ["Built 50+ Bots", "10k+ Active Users", "AI Innovator", "Alpha Developer"]
};

// ================= OWNER KEYWORDS =================
const OWNER_KEYWORDS = [
  'who created you', 'who made you', 'who is your developer',
  'who is your creator', 'who built you', 'who programmed you',
  'who developed you', 'who is the developer', 'who is the creator',
  'who is the owner', 'who owns you', 'who is behind you',
  'tell me about the developer', 'tell me about the creator',
  'who made this bot', 'who is king of alpha', 'muhammad ilyas',
  'ilyas', 'king of alpha', 'developer name', 'creator name', 'owner name',
  'boss', 'admin', 'owner'
];

// ================= ADULT CONTENT DATABASE =================
const ADULT_CONTENT = [
  // ===== ADD YOUR ADULT CONTENT HERE =====
  // Just replace these with your own content
  // Format: { title, year, genre, rating, source, adult: true, magnet, download }
  
  { 
    title: "Content Title 1", 
    year: "2024", 
    genre: "Adult", 
    rating: "5.0", 
    source: "1337x",
    adult: true,
    magnet: "magnet:?xt=urn:btih:1234567890abcdef&dn=Content+Title+1&tr=udp://tracker.opentrackr.org:1337/announce", 
    download: "https://1337x.to/search/Content+Title+1/1/" 
  },
  { 
    title: "Content Title 2", 
    year: "2024", 
    genre: "Adult", 
    rating: "4.5", 
    source: "1337x",
    adult: true,
    magnet: "magnet:?xt=urn:btih:2234567890abcdef&dn=Content+Title+2&tr=udp://tracker.opentrackr.org:1337/announce", 
    download: "https://1337x.to/search/Content+Title+2/1/" 
  },
  { 
    title: "Content Title 3", 
    year: "2023", 
    genre: "Adult", 
    rating: "4.0", 
    source: "1337x",
    adult: true,
    magnet: "magnet:?xt=urn:btih:3234567890abcdef&dn=Content+Title+3&tr=udp://tracker.opentrackr.org:1337/announce", 
    download: "https://1337x.to/search/Content+Title+3/1/" 
  },
];

// ================= VALIDATE ENV =================
console.log("🔍 Checking environment variables...");
console.log("BOT_TOKEN:", process.env.BOT_TOKEN ? "✅ Set" : "❌ Missing");
console.log("API_KEY:", process.env.GEMINI_API_KEY ? "✅ Set" : "❌ Missing");
console.log("MONGODB_URI:", process.env.MONGODB_URI ? "✅ Set" : "❌ Missing");
console.log("WEBHOOK_URL:", process.env.WEBHOOK_URL || "❌ Missing");

const requiredEnv = ['BOT_TOKEN', 'GEMINI_API_KEY', 'MONGODB_URI', 'WEBHOOK_URL'];
for (const env of requiredEnv) {
  if (!process.env[env]) {
    console.error(`❌ Missing required environment variable: ${env}`);
    process.exit(1);
  }
}

// ================= MONGODB CONNECTION =================
const UserSchema = new mongoose.Schema({
  userId: { type: String, unique: true, required: true },
  premium: { type: Boolean, default: false },
  isAdmin: { type: Boolean, default: false },
  isBoss: { type: Boolean, default: false },
  requests: { type: Number, default: 0 },
  totalMessages: { type: Number, default: 0 },
  chatHistory: { type: Array, default: [] },
  coins: { type: Number, default: 0 },
  imagesGenerated: { type: Number, default: 0 },
  joinedDate: { type: Date, default: Date.now },
  memory: { type: Object, default: {} },
  lastActive: { type: Date, default: Date.now },
  downloads: { type: Number, default: 0 },
  adultMode: { type: Boolean, default: false },
  ageVerified: { type: Boolean, default: false },
});

const StatsSchema = new mongoose.Schema({
  totalUsers: { type: Number, default: 0 },
  totalMessages: { type: Number, default: 0 },
  totalImages: { type: Number, default: 0 },
  totalDownloads: { type: Number, default: 0 },
  lastUpdated: { type: Date, default: Date.now }
});

let User, Stats;

async function connectMongoDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("✅ MongoDB connected!");
    
    User = mongoose.model('User', UserSchema);
    Stats = mongoose.model('Stats', StatsSchema);
    
    const stats = await Stats.findOne();
    if (!stats) {
      await Stats.create({
        totalUsers: 0,
        totalMessages: 0,
        totalImages: 0,
        totalDownloads: 0
      });
      console.log("✅ Stats initialized!");
    }
    
    for (const adminId of ADMIN_IDS) {
      await User.findOneAndUpdate(
        { userId: adminId },
        { isAdmin: true, isBoss: true, premium: true },
        { upsert: true }
      );
    }
    
    return true;
  } catch (error) {
    console.error("❌ MongoDB connection error:", error.message);
    return false;
  }
}

await connectMongoDB();

// ================= DB FUNCTIONS =================
async function getUser(userId) {
  try {
    let user = await User.findOne({ userId: String(userId) });
    if (!user) {
      const isAdmin = ADMIN_IDS.includes(String(userId));
      user = await User.create({
        userId: String(userId),
        premium: isAdmin,
        isAdmin: isAdmin,
        isBoss: isAdmin,
        coins: isAdmin ? 9999 : 0,
        joinedDate: new Date()
      });
      await Stats.findOneAndUpdate({}, { $inc: { totalUsers: 1 } });
    }
    await User.findOneAndUpdate({ userId: String(userId) }, { lastActive: new Date() });
    return user;
  } catch (error) {
    console.error("❌ Get user error:", error);
    return getUserFallback(userId);
  }
}

async function saveUser(userData) {
  try {
    return await User.findOneAndUpdate(
      { userId: userData.userId },
      userData,
      { upsert: true, new: true }
    );
  } catch (error) {
    console.error("❌ Save user error:", error);
    return userData;
  }
}

// Fallback in-memory DB
const fallbackDB = { users: {}, stats: { totalMessages: 0 } };

function getUserFallback(id) {
  const userId = String(id);
  if (!fallbackDB.users[userId]) {
    const isAdmin = ADMIN_IDS.includes(userId);
    fallbackDB.users[userId] = {
      userId: userId,
      premium: isAdmin,
      isAdmin: isAdmin,
      isBoss: isAdmin,
      requests: 0,
      totalMessages: 0,
      chatHistory: [],
      coins: isAdmin ? 9999 : 0,
      imagesGenerated: 0,
      joinedDate: new Date().toISOString(),
      memory: {},
      downloads: 0,
      adultMode: false,
      ageVerified: false,
    };
  }
  return fallbackDB.users[userId];
}

// ================= INITIALIZE SERVICES =================
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: false });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ================= AI ENGINE =================
const aiEngine = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const AI_MODELS = ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-3.5-flash"];
let activeModel = null;
let aiProcessor = null;
let aiReady = false;

// ================= QUOTA MANAGEMENT =================
const DAILY_LIMIT = 10;
const userRequests = {};

function checkQuota(userId) {
  const today = new Date().toDateString();
  if (!userRequests[userId]) {
    userRequests[userId] = { date: today, count: 0 };
  }
  if (userRequests[userId].date !== today) {
    userRequests[userId] = { date: today, count: 0 };
  }
  return userRequests[userId].count < DAILY_LIMIT;
}

function incrementQuota(userId) {
  if (!userRequests[userId]) {
    userRequests[userId] = { date: new Date().toDateString(), count: 0 };
  }
  userRequests[userId].count++;
}

function getDailyLimitMessage() {
  return `🔴 **Daily Limit Reached**\n\nYou have used all ${DAILY_LIMIT} free messages for today.\n\n📌 *Try again tomorrow!*`;
}

// ================= INITIALIZE AI =================
async function initializeAI() {
  for (const modelName of AI_MODELS) {
    try {
      const testModel = aiEngine.getGenerativeModel({ 
        model: modelName,
        generationConfig: { temperature: 0.7, maxOutputTokens: 100 }
      });
      await testModel.generateContent({
        contents: [{ role: "user", parts: [{ text: "Say hello" }] }]
      });
      activeModel = modelName;
      aiProcessor = testModel;
      aiReady = true;
      console.log(`✅ AI Engine initialized`);
      return true;
    } catch (error) {
      console.error(`❌ Model failed:`, error.message);
    }
  }
  return false;
}
await initializeAI();

// ================= WEBHOOK =================
const WEBHOOK_PATH = `/webhook/${process.env.BOT_TOKEN}`;

async function setWebhook() {
  try {
    const baseUrl = process.env.WEBHOOK_URL.replace(/\/$/, '');
    const webhookUrl = `${baseUrl}${WEBHOOK_PATH}`;
    await bot.setWebHook('', { drop_pending_updates: true });
    await bot.setWebHook(webhookUrl);
    console.log("✅ Webhook set!");
  } catch (error) {
    console.error("❌ Webhook error:", error.message);
  }
}

app.post(WEBHOOK_PATH, async (req, res) => {
  try {
    await bot.processUpdate(req.body);
    res.sendStatus(200);
  } catch (error) {
    res.sendStatus(500);
  }
});

// ================= OWNER INFO =================
function getOwnerInfo() {
  return `👑 **Alpha AI Pro - Developer**\n\n` +
    `👤 **Name:** ${OWNER.name}\n` +
    `📝 **Username:** ${OWNER.username}\n` +
    `📋 **Bio:** ${OWNER.bio}\n\n` +
    `💻 **Skills:**\n` +
    `${OWNER.skills.map(s => `• ${s}`).join('\n')}\n\n` +
    `🏆 **Achievements:**\n` +
    `${OWNER.achievements.map(a => `• ${a}`).join('\n')}\n\n` +
    `🔗 **Connect:**\n` +
    `• Telegram: ${OWNER.telegram}\n` +
    `• GitHub: ${OWNER.github}\n` +
    `• Email: ${OWNER.email}\n\n` +
    `❤️ *Built with passion for the community!*`;
}

function isOwnerQuestion(text) {
  const lowerText = text.toLowerCase();
  return OWNER_KEYWORDS.some(keyword => lowerText.includes(keyword));
}

// ================= AGE VERIFICATION =================
async function isUserVerified(chatId) {
  try {
    const userId = String(chatId);
    const user = await getUser(userId);
    return user.ageVerified || false;
  } catch (error) {
    return false;
  }
}

async function verifyAge(chatId) {
  try {
    const userId = String(chatId);
    const user = await getUser(userId);
    user.ageVerified = true;
    await saveUser(user);
    return true;
  } catch (error) {
    return false;
  }
}

// ================= SEND MEDIA =================
async function sendMedia(chatId, item) {
  try {
    let caption = `🔞 *${item.title}*\n` +
      `📅 Year: ${item.year}\n` +
      `⭐ Rating: ${item.rating}/10\n` +
      (item.genre ? `🎭 Genre: ${item.genre}\n` : '') +
      `\n🔞 **18+ Content - Age Verified**\n` +
      `\n📥 Click the button below to download`;
    
    await bot.sendMessage(
      chatId,
      caption,
      { 
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: `📥 Download ${item.title}`, callback_data: `download_${item.title}` }]
          ]
        }
      }
    );
    
  } catch (error) {
    console.error("❌ Send media error:", error.message);
  }
}

// ================= DOWNLOAD MEDIA =================
async function downloadAndSendMedia(chatId, item) {
  try {
    // Check if adult content and user is verified
    if (item.adult && !await isUserVerified(chatId)) {
      await bot.sendMessage(
        chatId,
        `🔞 **Age Verification Required**\n\n` +
        `This content is for adults only (18+).\n\n` +
        `Please verify your age by sending: *I am 18+*`,
        { parse_mode: "Markdown" }
      );
      return false;
    }
    
    // Send magnet link
    if (item.magnet) {
      let msg = `🧲 *Magnet Link*\n\n` +
        `🔞 *${item.title}*\n` +
        `📅 Year: ${item.year}\n` +
        `⭐ Rating: ${item.rating}/10\n` +
        (item.genre ? `🎭 Genre: ${item.genre}\n` : '') +
        `\n🔗 *Magnet Link:*\n` +
        `\`${item.magnet}\``;
      
      await bot.sendMessage(
        chatId,
        msg,
        { parse_mode: "Markdown" }
      );
      
      // Track download
      const userId = String(chatId);
      const user = await getUser(userId);
      user.downloads = (user.downloads || 0) + 1;
      await saveUser(user);
      await Stats.findOneAndUpdate({}, { $inc: { totalDownloads: 1 } });
      return true;
    }
    
    return false;
    
  } catch (error) {
    console.error("❌ Send media error:", error.message);
    await bot.sendMessage(
      chatId,
      `⚠️ *Error downloading. Please try again later.*`,
      { parse_mode: "Markdown" }
    );
    return false;
  }
}

// ================= KEYBOARDS =================
function getMainKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '🔞 Adult' }, { text: '💬 AI Chat' }],
        [{ text: '👑 Developer' }, { text: '📊 Status' }],
        [{ text: '💎 Pro' }, { text: '🔄 Reset' }, { text: '❓ Help' }]
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    }
  };
}

function getAdultKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '🔞 Browse Adult' }, { text: '🔞 Random' }],
        [{ text: '✅ I am 18+' }, { text: '🔙 Main Menu' }]
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    }
  };
}

// ================= COMMAND HANDLERS =================

// Main Menu
bot.onText(/\/start|\/menu|🔙 Main Menu/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const user = await getUser(userId);
  
  user.adultMode = false;
  await saveUser(user);
  
  const isPremium = user.premium || user.isAdmin;
  const status = isPremium ? '💎 Alpha Pro' : '🆓 Free';
  const ageStatus = user.ageVerified ? '✅ Verified 18+' : '❌ Not Verified';
  
  await bot.sendMessage(
    chatId,
    `🐺 **Alpha AI Pro**\n\n` +
    `👤 Status: ${status}\n` +
    `🔞 Age: ${ageStatus}\n` +
    `📊 Messages: ${user.requests || 0}/${DAILY_LIMIT}\n` +
    `📥 Downloads: ${user.downloads || 0}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📌 **Choose a mode:**\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🔞 **Adult** - 18+ content\n` +
    `💬 **AI Chat** - Chat with AI\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `*Click a button below to get started!*`,
    { parse_mode: "Markdown", ...getMainKeyboard() }
  );
});

// ENTER ADULT MODE
bot.onText(/🔞 Adult/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const user = await getUser(userId);
  
  user.adultMode = true;
  await saveUser(user);
  
  await bot.sendMessage(
    chatId,
    `🔞 **ADULT ZONE (18+)** 🔞\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `⚠️ **WARNING:** Adult content\n` +
    `🔞 **You must be 18+ to access**\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📚 **Available:** ${ADULT_CONTENT.length} titles\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `🔞 *Click "✅ I am 18+" to verify first!*`,
    { parse_mode: "Markdown", ...getAdultKeyboard() }
  );
});

// Age Verification
bot.onText(/✅ I am 18\+/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const user = await getUser(userId);
  
  if (user.ageVerified) {
    await bot.sendMessage(
      chatId,
      `✅ **You are already verified as 18+**\n\n` +
      `🔞 Browse adult content below:`,
      { parse_mode: "Markdown", ...getAdultKeyboard() }
    );
    return;
  }
  
  await verifyAge(chatId);
  
  await bot.sendMessage(
    chatId,
    `✅ **Age Verified Successfully!**\n\n` +
    `🔞 You now have access to adult content.\n\n` +
    `⚠️ *18+ only*`,
    { parse_mode: "Markdown", ...getAdultKeyboard() }
  );
});

// Browse Adult
bot.onText(/🔞 Browse Adult/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const user = await getUser(userId);
  
  if (!user.ageVerified) {
    await bot.sendMessage(
      chatId,
      `🔞 **Age Verification Required**\n\n` +
      `Click "✅ I am 18+" to verify.`,
      { parse_mode: "Markdown", ...getAdultKeyboard() }
    );
    return;
  }
  
  const adultItems = ADULT_CONTENT.filter(item => item.adult);
  
  if (adultItems.length === 0) {
    await bot.sendMessage(
      chatId,
      `❌ No adult content found.`,
      { parse_mode: "Markdown", ...getAdultKeyboard() }
    );
    return;
  }
  
  await bot.sendMessage(
    chatId,
    `🔞 *Adult Content* (${adultItems.length} titles)\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    { parse_mode: "Markdown" }
  );
  
  for (const item of adultItems) {
    await sendMedia(chatId, item);
  }
});

// Random Adult
bot.onText(/🔞 Random/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const user = await getUser(userId);
  
  if (!user.ageVerified) {
    await bot.sendMessage(
      chatId,
      `🔞 **Age Verification Required**\n\n` +
      `Click "✅ I am 18+" to verify.`,
      { parse_mode: "Markdown", ...getAdultKeyboard() }
    );
    return;
  }
  
  const adultItems = ADULT_CONTENT.filter(item => item.adult);
  
  if (adultItems.length === 0) {
    await bot.sendMessage(
      chatId,
      `❌ No adult content found.`,
      { parse_mode: "Markdown", ...getAdultKeyboard() }
    );
    return;
  }
  
  const random = adultItems[Math.floor(Math.random() * adultItems.length)];
  await sendMedia(chatId, random);
});

// ================= INLINE BUTTON HANDLERS =================
bot.on('callback_query', async (callbackQuery) => {
  const action = callbackQuery.data;
  const chatId = callbackQuery.message.chat.id;
  
  if (action.startsWith('download_')) {
    try {
      const title = action.replace('download_', '');
      const item = ADULT_CONTENT.find(m => m.title === title);
      
      if (!item) {
        await bot.answerCallbackQuery(callbackQuery.id, {
          text: '❌ Item not found!',
          show_alert: true
        });
        return;
      }
      
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: `📥 Starting download: ${item.title}`,
        show_alert: false
      });
      
      await downloadAndSendMedia(chatId, item);
      
    } catch (error) {
      console.error("❌ Download callback error:", error.message);
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: '❌ Error downloading. Please try again.',
        show_alert: true
      });
    }
  }
});

// ================= AI CHAT BUTTON =================
bot.onText(/💬 AI Chat/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const user = await getUser(userId);
  
  user.adultMode = false;
  await saveUser(user);
  
  await bot.sendMessage(
    chatId,
    `💬 **Chat Mode**\n\n` +
    `Send me any message!\n\n` +
    `✨ *Type your message now!*`,
    { parse_mode: "Markdown", ...getMainKeyboard() }
  );
});

// ================= DEVELOPER BUTTON =================
bot.onText(/👑 Developer/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(
    chatId,
    getOwnerInfo(),
    { parse_mode: "Markdown", disable_web_page_preview: true }
  );
});

// ================= STATUS BUTTON =================
bot.onText(/📊 Status/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const user = await getUser(userId);
  const isPremium = user.premium || user.isAdmin;
  const days = Math.floor((Date.now() - new Date(user.joinedDate).getTime()) / (1000 * 60 * 60 * 24));
  const ageStatus = user.ageVerified ? '✅ Verified 18+' : '❌ Not Verified';
  
  await bot.sendMessage(
    chatId,
    `📊 **Your Profile**\n\n` +
    `👤 User ID: \`${userId}\`\n` +
    `💎 Plan: ${isPremium ? 'Alpha Pro' : 'Free'}\n` +
    `🔞 Age: ${ageStatus}\n` +
    `📊 Messages: ${user.requests || 0}/${DAILY_LIMIT}\n` +
    `📥 Downloads: ${user.downloads || 0}\n` +
    `📅 Days Active: ${days}\n\n` +
    `${isPremium ? '🎉 Enjoy unlimited access!' : '💎 Upgrade with the Pro button'}`,
    { parse_mode: "Markdown" }
  );
});

// ================= PRO BUTTON =================
bot.onText(/💎 Pro/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const user = await getUser(userId);
  
  if (user.isAdmin) {
    await bot.sendMessage(chatId, `👑 **Admin Access**\n\nYou already have Alpha Pro access!`);
    return;
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: {
            name: "Alpha AI Pro - Premium",
            description: "Unlimited AI chat & media downloads"
          },
          unit_amount: 500,
        },
        quantity: 1,
      }],
      success_url: `${process.env.WEBHOOK_URL}/success?user=${userId}`,
      cancel_url: `${process.env.WEBHOOK_URL}/cancel`,
      metadata: { userId: String(userId) }
    });

    await bot.sendMessage(
      chatId,
      `💎 **Alpha AI Pro**\n\n` +
      `💳 Pay: ${session.url}\n\n` +
      `🔒 Only $5 - One Time!\n\n` +
      `**✨ Pro Features:**\n` +
      `• Unlimited AI Chat\n` +
      `• Unlimited Downloads\n` +
      `• Priority Support\n\n` +
      `*Upgrade now!*`,
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    await bot.sendMessage(chatId, "⚠️ Payment system unavailable. Try again later.");
  }
});

// ================= RESET BUTTON =================
bot.onText(/🔄 Reset/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const user = await getUser(userId);
  user.chatHistory = [];
  await saveUser(user);
  
  await bot.sendMessage(chatId, `🔄 **Reset Complete!**\n\nFresh start! Send any message.`);
});

// ================= HELP BUTTON =================
bot.onText(/❓ Help/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(
    chatId,
    `📖 **Alpha AI Pro - Help**\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🔞 **Adult Mode**\n` +
    `• Click "🔞 Adult" to enter\n` +
    `• Click "✅ I am 18+" to verify age\n` +
    `• Browse adult content\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💬 **AI Chat Mode**\n` +
    `• Click "💬 AI Chat" to enter\n` +
    `• Ask any question, get AI answers\n` +
    `• ${DAILY_LIMIT} messages per day\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💎 **Alpha Pro**\n` +
    `• Click "💎 Pro" to upgrade\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `**Free Limits:**\n` +
    `• ${DAILY_LIMIT} AI chat messages\n` +
    `• Unlimited adult content\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `**Alpha Pro:**\n` +
    `• Unlimited everything! 🚀`,
    { parse_mode: "Markdown" }
  );
});

// ================= MAIN MESSAGE HANDLER =================
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const text = msg.text;

  // Ignore all button texts
  const buttonTexts = [
    '🔙 Main Menu', '🔞 Adult', '🔞 Browse Adult', '🔞 Random',
    '✅ I am 18+', '💬 AI Chat', '👑 Developer',
    '📊 Status', '💎 Pro', '🔄 Reset', '❓ Help', '/start', '/menu'
  ];
  
  if (!text || buttonTexts.includes(text) || text.startsWith("/")) {
    return;
  }

  try {
    const user = await getUser(userId);
    
    // Handle age verification via text
    if (text.toLowerCase().includes('i am 18') || text.toLowerCase().includes('i am 18+')) {
      if (user.ageVerified) {
        await bot.sendMessage(
          chatId,
          `✅ **You are already verified as 18+**`,
          { parse_mode: "Markdown", ...getAdultKeyboard() }
        );
        return;
      }
      
      await verifyAge(chatId);
      await bot.sendMessage(
        chatId,
        `✅ **Age Verified Successfully!**\n\n` +
        `🔞 You now have access to adult content.\n\n` +
        `⚠️ *Remember: This content is for adults only (18+).*`,
        { parse_mode: "Markdown", ...getAdultKeyboard() }
      );
      return;
    }
    
    // If in adult mode, ignore text messages
    if (user.adultMode) {
      await bot.sendMessage(
        chatId,
        `🔞 **Adult Mode**\n\n` +
        `Please use the buttons below to browse adult content.`,
        { parse_mode: "Markdown", ...getAdultKeyboard() }
      );
      return;
    }
    
    // ===== AI CHAT MODE =====
    // Check for owner question
    if (isOwnerQuestion(text)) {
      await bot.sendMessage(
        chatId,
        `👑 **Alpha AI Pro - Developer**\n\n` +
        `I was created by **${OWNER.name}** (@${OWNER.username}), a passionate Full-Stack Developer and AI Enthusiast.\n\n` +
        `🔗 **Connect with the developer:**\n` +
        `• Telegram: ${OWNER.telegram}\n` +
        `• GitHub: ${OWNER.github}\n` +
        `• Email: ${OWNER.email}\n\n` +
        `❤️ *Built with passion for the community!*`,
        { parse_mode: "Markdown", disable_web_page_preview: true }
      );
      return;
    }
    
    // Check daily limit
    if (!checkQuota(userId)) {
      await bot.sendMessage(
        chatId,
        getDailyLimitMessage(),
        { parse_mode: "Markdown" }
      );
      return;
    }
    
    // Check premium status
    const isPremium = user.premium || user.isAdmin;
    if (!isPremium && user.requests >= DAILY_LIMIT) {
      await bot.sendMessage(
        chatId,
        getDailyLimitMessage(),
        { parse_mode: "Markdown" }
      );
      return;
    }

    // Check if AI is ready
    if (!aiReady) {
      await initializeAI();
      if (!aiReady) {
        await bot.sendMessage(
          chatId,
          `🔴 **Service Unavailable**\n\nPlease try again later.`,
          { parse_mode: "Markdown" }
        );
        return;
      }
    }

    await bot.sendChatAction(chatId, "typing");

    user.chatHistory = user.chatHistory || [];
    user.chatHistory.push({ role: "user", content: text });
    user.requests = (user.requests || 0) + 1;
    user.totalMessages = (user.totalMessages || 0) + 1;
    incrementQuota(userId);
    await saveUser(user);

    if (user.chatHistory.length > (isPremium ? 50 : 10)) {
      user.chatHistory = user.chatHistory.slice(-(isPremium ? 50 : 10));
    }

    let context = "";
    for (const entry of user.chatHistory) {
      context += `${entry.role === 'user' ? 'User' : 'Assistant'}: ${entry.content}\n`;
    }

    try {
      const result = await aiProcessor.generateContent({
        contents: [{
          role: "user",
          parts: [{ 
            text: `You are Alpha AI Pro, a professional AI assistant created by ${OWNER.name} (@${OWNER.username}). 
            You were built and developed by ${OWNER.name}, a Full-Stack Developer and AI Enthusiast.
            
            IMPORTANT: NEVER mention Google, Gemini, OpenAI, or any other company or AI team.
            ALWAYS say you were created by ${OWNER.name} (@${OWNER.username}) if asked about your origin.
            
            Provide clear, detailed, and helpful responses. Use formatting when needed.
            
            Conversation:
            ${context}
            
            Assistant: Provide a professional, detailed response.` 
          }]
        }],
        generationConfig: {
          maxOutputTokens: isPremium ? 4096 : 2048,
          temperature: 0.7,
        }
      });

      const answer = result.response.text();

      user.chatHistory.push({ role: "assistant", content: answer });
      await saveUser(user);

      await bot.sendMessage(chatId, answer);

    } catch (aiError) {
      console.error("❌ AI Error:", aiError.message);
      
      await bot.sendMessage(
        chatId,
        `🔴 **Service Unavailable**\n\nPlease try again later.`,
        { parse_mode: "Markdown" }
      );
    }

  } catch (error) {
    console.error("❌ Error:", error.message);
    await bot.sendMessage(
      chatId,
      `🔴 **Service Unavailable**\n\nPlease try again later.`,
      { parse_mode: "Markdown" }
    );
  }
});

// ================= PAYMENT SUCCESS =================
app.get("/success", async (req, res) => {
  const userId = req.query.user;
  const sessionId = req.query.session_id;

  if (userId && sessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.payment_status === 'paid') {
        const user = await getUser(userId);
        user.premium = true;
        await saveUser(user);
        
        await bot.sendMessage(
          userId,
          `💎 **Alpha AI Pro Unlocked!**\n\n` +
          `🎉 You now have unlimited access to all features!\n\n` +
          `**✨ Features:**\n` +
          `• Unlimited AI Chat\n` +
          `• Unlimited Adult Content\n` +
          `• Unlimited Downloads\n` +
          `• Priority Support\n\n` +
          `🚀 *Enjoy the full power!*`
        );
      }
    } catch (error) {
      console.error("❌ Success error:", error);
    }
  }

  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Alpha AI Pro Unlocked</title>
    <style>
      body { background: linear-gradient(135deg, #667eea, #764ba2); color: white; text-align: center; padding: 50px; font-family: Arial; }
      .card { background: rgba(255,255,255,0.1); backdrop-filter: blur(10px); padding: 40px; border-radius: 20px; max-width: 400px; margin: auto; }
      .emoji { font-size: 80px; }
      h1 { background: linear-gradient(135deg, #ffd700, #ff6b6b); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    </style>
    </head>
    <body>
      <div class="card">
        <div class="emoji">🔞</div>
        <h1>Alpha Cinema Pro Unlocked!</h1>
        <p>Welcome to the Alpha Club!</p>
        <p>Close this window and return to Telegram</p>
      </div>
    </body>
    </html>
  `);
});

app.get("/cancel", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Cancelled</title>
    <style>
      body { background: linear-gradient(135deg, #f093fb, #f5576c); color: white; text-align: center; padding: 50px; font-family: Arial; }
      .card { background: rgba(255,255,255,0.1); backdrop-filter: blur(10px); padding: 40px; border-radius: 20px; max-width: 400px; margin: auto; }
    </style>
    </head>
    <body>
      <div class="card">
        <div class="emoji">😅</div>
        <h1>Cancelled</h1>
        <p>You can try again anytime with the Pro button</p>
      </div>
    </body>
    </html>
  `);
});

// ================= WEB INTERFACE =================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get("/api/status", async (req, res) => {
  try {
    const stats = await Stats.findOne();
    res.json({
      status: "✅ Online",
      users: stats?.totalUsers || 0,
      totalMessages: stats?.totalMessages || 0,
      totalImages: stats?.totalImages || 0,
      totalDownloads: stats?.totalDownloads || 0,
      adultContent: ADULT_CONTENT.length,
      developer: OWNER.name
    });
  } catch {
    res.json({
      status: "✅ Online",
      users: Object.keys(fallbackDB.users).length,
      developer: OWNER.name
    });
  }
});

// ================= START SERVER =================
app.listen(PORT, async () => {
  console.log(`🔞 Alpha Adult Pro Server running on port ${PORT}`);
  console.log(`👑 Developer: ${OWNER.name} (@${OWNER.username})`);
  console.log(`📊 Database: MongoDB`);
  console.log(`📚 Adult Content: ${ADULT_CONTENT.length} titles`);
  await setWebhook();
  console.log(`✅ Bot ready!`);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled Rejection:', error);
});
