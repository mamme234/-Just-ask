import express from "express";
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import Stripe from "stripe";
import { GoogleGenerativeAI } from "@google/generative-ai";
import axios from "axios";
import path from "path";
import { fileURLToPath } from 'url';
import { createCanvas } from 'canvas';
import mongoose from "mongoose";
import fs from "fs";
import { MEDIA_DB, getMediaByCategory, getMediaCount } from './media/index.js';

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
  filmMode: { type: Boolean, default: false },
  currentPage: { type: Number, default: 0 },
  currentCategory: { type: String, default: 'americanMovies' }
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
      filmMode: false,
      currentPage: 0,
      currentCategory: 'americanMovies'
    };
  }
  return fallbackDB.users[userId];
}

// ================= INITIALIZE SERVICES =================
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: false });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ================= AI ENGINE (Hidden - No Google Names) =================
// Using AI engine but never mentioning its name
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

// ================= MEDIA FUNCTIONS =================
function getCategoryEmoji(category) {
  const emojis = {
    'Action': '⚔️', 'Adventure': '🗺️', 'Animation': '🎨',
    'Comedy': '😂', 'Crime': '🔫', 'Drama': '🎭',
    'Fantasy': '🐉', 'Horror': '👻', 'Romance': '❤️',
    'Sci-Fi': '🚀', 'Thriller': '🔪', 'Western': '🤠',
    'Historical': '🏰', 'Family': '👨‍👩‍👧‍👦'
  };
  return emojis[category] || '🎬';
}

function getItemsByCategory(category, page = 0, perPage = 5) {
  const items = getMediaByCategory(category) || [];
  const total = items.length;
  const start = page * perPage;
  const end = start + perPage;
  const paginated = items.slice(start, end);
  return { items: paginated, total, hasMore: end < total };
}

function getRandomMedia() {
  const all = [];
  const categories = Object.keys(MEDIA_DB);
  for (const cat of categories) {
    const items = MEDIA_DB[cat] || [];
    for (const item of items) {
      all.push({ ...item, category: cat });
    }
  }
  return all[Math.floor(Math.random() * all.length)];
}

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

// ================= SEND MEDIA =================
async function sendMedia(chatId, item, category) {
  try {
    const emojiMap = {
      'turkish': '🇹🇷', 'kdrama': '🇰🇷', 'anime': '🎌',
      'americanMovies': '🎬', 'americanTV': '📺', 'indian': '🇮🇳',
      'arabic': '🇦🇪', 'korean': '🇰🇷', 'japanese': '🇯🇵',
      'european': '🇪🇺'
    };
    const emoji = emojiMap[category] || '🎬';
    
    const typeNames = {
      'turkish': 'Turkish Series', 'kdrama': 'K-Drama',
      'anime': 'Anime', 'americanMovies': 'Movie',
      'americanTV': 'TV Series', 'indian': 'Indian Movie',
      'arabic': 'Arabic Series', 'korean': 'Korean Movie',
      'japanese': 'Japanese Movie', 'european': 'European Movie'
    };
    const typeName = typeNames[category] || 'Media';
    
    const caption = `${emoji} *${item.title}*\n` +
      `📅 Year: ${item.year}\n` +
      `📋 Type: ${typeName}\n` +
      `⭐ Rating: ${item.rating}/10\n` +
      (item.genre ? `🎭 Genre: ${item.genre}\n` : '') +
      (item.seasons ? `📅 Seasons: ${item.seasons}\n` : '') +
      (item.episodes ? `📅 Episodes: ${item.episodes}\n` : '') +
      `\n📥 Click the button below to download`;
    
    const downloadData = `download_${category}_${item.title}`;
    
    // If it's a magnet link, show source
    if (item.magnet) {
      const sourceNames = {
        '1337x': '🎬 1337x',
        'nyaa': '🎌 Nyaa.si',
        'yts': '🎥 YTS',
        'fitgirl': '🎮 FitGirl'
      };
      const sourceDisplay = sourceNames[item.source] || '📥';
      caption += `\n📡 Source: ${sourceDisplay}`;
    }
    
    await bot.sendMessage(
      chatId,
      caption,
      { 
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: `📥 Download ${item.title}`, callback_data: downloadData }]
          ]
        }
      }
    );
    
  } catch (error) {
    console.error("❌ Send media error:", error.message);
    await bot.sendMessage(
      chatId,
      `${emoji} *${item.title}*\n📅 Year: ${item.year}\n⭐ Rating: ${item.rating}/10\n\n📥 Click the button below to download`,
      { 
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: `📥 Download ${item.title}`, callback_data: `download_${category}_${item.title}` }]
          ]
        }
      }
    );
  }
}

// ================= DOWNLOAD MEDIA =================
async function downloadAndSendMedia(chatId, item, category) {
  try {
    // If magnet link, send magnet directly
    if (item.magnet) {
      const sourceEmojis = {
        '1337x': '🎬',
        'nyaa': '🎌',
        'yts': '🎥',
        'fitgirl': '🎮'
      };
      const emoji = sourceEmojis[item.source] || '🧲';
      const sourceNames = {
        '1337x': '1337x',
        'nyaa': 'Nyaa.si',
        'yts': 'YTS',
        'fitgirl': 'FitGirl Repacks'
      };
      const sourceName = sourceNames[item.source] || 'Torrent';
      
      await bot.sendMessage(
        chatId,
        `🧲 *Magnet Link*\n\n` +
        `🎬 *${item.title}*\n` +
        `📅 Year: ${item.year}\n` +
        `⭐ Rating: ${item.rating}/10\n` +
        (item.genre ? `🎭 Genre: ${item.genre}\n` : '') +
        (item.seasons ? `📅 Seasons: ${item.seasons}\n` : '') +
        (item.episodes ? `📅 Episodes: ${item.episodes}\n` : '') +
        `\n📡 Source: ${emoji} ${sourceName}\n\n` +
        `🔗 *Magnet Link:*\n` +
        `\`${item.magnet}\``,
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
    
    // Regular download for non-magnet links
    const statusMsg = await bot.sendMessage(
      chatId,
      `📥 *Downloading: ${item.title}*...\n\n⏳ Please wait, this may take a moment.`,
      { parse_mode: "Markdown" }
    );
    
    try {
      const response = await axios({
        method: 'GET',
        url: item.download,
        responseType: 'stream',
        timeout: 120000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      if (!fs.existsSync(path.join(__dirname, 'temp'))) {
        fs.mkdirSync(path.join(__dirname, 'temp'));
      }
      
      const tempFile = path.join(__dirname, 'temp', `${Date.now()}_${item.title.replace(/[^a-zA-Z0-9]/g, '_')}.mp4`);
      
      const writer = fs.createWriteStream(tempFile);
      response.data.pipe(writer);
      
      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
      
      const stats = fs.statSync(tempFile);
      const fileSizeMB = stats.size / (1024 * 1024);
      
      const caption = `✅ *Download Complete!*\n\n` +
        `🎬 *${item.title}*\n` +
        `📅 Year: ${item.year}\n` +
        `⭐ Rating: ${item.rating}/10\n` +
        (item.genre ? `🎭 Genre: ${item.genre}\n` : '') +
        (item.seasons ? `📅 Seasons: ${item.seasons}\n` : '') +
        (item.episodes ? `📅 Episodes: ${item.episodes}\n` : '') +
        `📦 Size: ${fileSizeMB.toFixed(1)} MB\n` +
        `\n📥 *File sent successfully!*`;
      
      await bot.sendVideo(chatId, tempFile, { 
        caption: caption,
        supports_streaming: true
      });
      
      try {
        fs.unlinkSync(tempFile);
      } catch (e) {}
      
      await bot.editMessageText(
        `✅ *Download Complete!*\n\n${item.title} has been sent to you.`,
        {
          chat_id: chatId,
          message_id: statusMsg.message_id,
          parse_mode: "Markdown"
        }
      );
      
      const userId = String(chatId);
      const user = await getUser(userId);
      user.downloads = (user.downloads || 0) + 1;
      await saveUser(user);
      await Stats.findOneAndUpdate({}, { $inc: { totalDownloads: 1 } });
      
      return true;
      
    } catch (downloadError) {
      console.error("❌ Download error:", downloadError.message);
      
      await bot.editMessageText(
        `⚠️ *Could not download the file.*\n\nPlease try again later.`,
        {
          chat_id: chatId,
          message_id: statusMsg.message_id,
          parse_mode: "Markdown"
        }
      );
      
      return false;
    }
    
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
        [{ text: '🎬 Film Download' }, { text: '💬 AI Chat' }],
        [{ text: '👑 Developer' }, { text: '📊 Status' }],
        [{ text: '💎 Pro' }, { text: '🔄 Reset' }, { text: '❓ Help' }]
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    }
  };
}

function getFilmCategoryKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '🇹🇷 Turkish' }, { text: '🇰🇷 K-Drama' }, { text: '🎌 Anime' }],
        [{ text: '🎬 American Movies' }, { text: '📺 American TV' }, { text: '🇮🇳 Indian' }],
        [{ text: '🇦🇪 Arabic' }, { text: '🇰🇷 Korean Movies' }, { text: '🇯🇵 Japanese' }],
        [{ text: '🇪🇺 European' }, { text: '🎲 Random Pick' }],
        [{ text: '🔙 Exit Film Mode' }]
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    }
  };
}

// ================= CATEGORY MAP =================
const categoryMap = {
  '🇹🇷 Turkish': 'turkish',
  '🇰🇷 K-Drama': 'kdrama',
  '🎌 Anime': 'anime',
  '🎬 American Movies': 'americanMovies',
  '📺 American TV': 'americanTV',
  '🇮🇳 Indian': 'indian',
  '🇦🇪 Arabic': 'arabic',
  '🇰🇷 Korean Movies': 'korean',
  '🇯🇵 Japanese': 'japanese',
  '🇪🇺 European': 'european'
};

// ================= COMMAND HANDLERS =================

// Main Menu
bot.onText(/\/start|\/menu/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const user = await getUser(userId);
  
  user.filmMode = false;
  user.currentPage = 0;
  await saveUser(user);
  
  const isPremium = user.premium || user.isAdmin;
  const status = isPremium ? '💎 Alpha Pro' : '🆓 Free';
  const counts = getMediaCount();
  
  await bot.sendMessage(
    chatId,
    `🐺 **Alpha AI Pro**\n\n` +
    `👤 Status: ${status}\n` +
    `📊 Messages: ${user.requests || 0}/${DAILY_LIMIT}\n` +
    `📥 Downloads: ${user.downloads || 0}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📚 **Media Library**\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🇹🇷 Turkish: ${counts.turkish}\n` +
    `🇰🇷 K-Drama: ${counts.kdrama}\n` +
    `🎌 Anime: ${counts.anime}\n` +
    `🎬 American Movies: ${counts.americanMovies}\n` +
    `📺 American TV: ${counts.americanTV}\n` +
    `🇮🇳 Indian: ${counts.indian}\n` +
    `🇦🇪 Arabic: ${counts.arabic}\n` +
    `🇰🇷 Korean Movies: ${counts.korean}\n` +
    `🇯🇵 Japanese: ${counts.japanese}\n` +
    `🇪🇺 European: ${counts.european}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📊 Total: ${counts.total} titles\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `📌 **Choose a mode:**\n` +
    `🎬 *Film Download* - Browse & download\n` +
    `💬 *AI Chat* - Chat with AI assistant\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `*Click a button below to get started!*`,
    { parse_mode: "Markdown", ...getMainKeyboard() }
  );
});

// ENTER FILM MODE
bot.onText(/🎬 Film Download/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const user = await getUser(userId);
  
  user.filmMode = true;
  user.currentPage = 0;
  await saveUser(user);
  
  const counts = getMediaCount();
  
  await bot.sendMessage(
    chatId,
    `🎬 **ALPHA CINEMA** 🎬\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📚 **FILM LIBRARY**\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🇹🇷 Turkish: ${counts.turkish}\n` +
    `🇰🇷 K-Drama: ${counts.kdrama}\n` +
    `🎌 Anime: ${counts.anime}\n` +
    `🎬 American Movies: ${counts.americanMovies}\n` +
    `📺 American TV: ${counts.americanTV}\n` +
    `🇮🇳 Indian: ${counts.indian}\n` +
    `🇦🇪 Arabic: ${counts.arabic}\n` +
    `🇰🇷 Korean Movies: ${counts.korean}\n` +
    `🇯🇵 Japanese: ${counts.japanese}\n` +
    `🇪🇺 European: ${counts.european}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📊 Total: ${counts.total} titles\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `🔍 *Select a category below to browse:*`,
    { parse_mode: "Markdown", ...getFilmCategoryKeyboard() }
  );
});

// EXIT FILM MODE
bot.onText(/🔙 Exit Film Mode/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const user = await getUser(userId);
  
  user.filmMode = false;
  user.currentPage = 0;
  await saveUser(user);
  
  await bot.sendMessage(
    chatId,
    `✅ **Exited Film Mode**\n\n` +
    `You are now back in the main menu.\n\n` +
    `📌 Choose an option:`,
    { parse_mode: "Markdown", ...getMainKeyboard() }
  );
});

// ================= CATEGORY HANDLERS =================
async function showCategory(chatId, userId, category, title, emoji) {
  const user = await getUser(userId);
  
  if (!user.filmMode) {
    await bot.sendMessage(
      chatId,
      `🎬 Please enter **Film Download** mode first!\n\nClick the "🎬 Film Download" button.`,
      { parse_mode: "Markdown" }
    );
    return;
  }
  
  user.currentCategory = category;
  user.currentPage = 0;
  await saveUser(user);
  
  const { items, total, hasMore } = getItemsByCategory(category, 0);
  
  if (items.length === 0) {
    await bot.sendMessage(
      chatId,
      `❌ No ${title} found.`,
      { parse_mode: "Markdown", ...getFilmCategoryKeyboard() }
    );
    return;
  }
  
  await bot.sendMessage(
    chatId,
    `${emoji} *${title}* (${total} titles)\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    { parse_mode: "Markdown" }
  );
  
  for (const item of items) {
    await sendMedia(chatId, item, category);
  }
  
  const navButtons = [];
  if (hasMore) {
    navButtons.push({ text: `⏩ Next Page (${total} total)`, callback_data: `page_${category}_1` });
  }
  navButtons.push({ text: `🔙 Back to Categories`, callback_data: `back_categories` });
  
  await bot.sendMessage(
    chatId,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📌 *Navigation:*`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [navButtons]
      }
    }
  );
}

// Category Button Handlers
bot.onText(/🇹🇷 Turkish/, async (msg) => {
  await showCategory(msg.chat.id, String(msg.from.id), 'turkish', 'Turkish Series', '🇹🇷');
});

bot.onText(/🇰🇷 K-Drama/, async (msg) => {
  await showCategory(msg.chat.id, String(msg.from.id), 'kdrama', 'K-Drama', '🇰🇷');
});

bot.onText(/🎌 Anime/, async (msg) => {
  await showCategory(msg.chat.id, String(msg.from.id), 'anime', 'Anime', '🎌');
});

bot.onText(/🎬 American Movies/, async (msg) => {
  await showCategory(msg.chat.id, String(msg.from.id), 'americanMovies', 'American Movies', '🎬');
});

bot.onText(/📺 American TV/, async (msg) => {
  await showCategory(msg.chat.id, String(msg.from.id), 'americanTV', 'American TV Series', '📺');
});

bot.onText(/🇮🇳 Indian/, async (msg) => {
  await showCategory(msg.chat.id, String(msg.from.id), 'indian', 'Indian Movies', '🇮🇳');
});

bot.onText(/🇦🇪 Arabic/, async (msg) => {
  await showCategory(msg.chat.id, String(msg.from.id), 'arabic', 'Arabic Series', '🇦🇪');
});

bot.onText(/🇰🇷 Korean Movies/, async (msg) => {
  await showCategory(msg.chat.id, String(msg.from.id), 'korean', 'Korean Movies', '🇰🇷');
});

bot.onText(/🇯🇵 Japanese/, async (msg) => {
  await showCategory(msg.chat.id, String(msg.from.id), 'japanese', 'Japanese Movies', '🇯🇵');
});

bot.onText(/🇪🇺 European/, async (msg) => {
  await showCategory(msg.chat.id, String(msg.from.id), 'european', 'European Movies', '🇪🇺');
});

// Random Pick
bot.onText(/🎲 Random Pick/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const user = await getUser(userId);
  
  if (!user.filmMode) {
    await bot.sendMessage(
      chatId,
      `🎬 Please enter **Film Download** mode first!\n\nClick the "🎬 Film Download" button.`,
      { parse_mode: "Markdown" }
    );
    return;
  }
  
  const random = getRandomMedia();
  await sendMedia(chatId, random, random.category);
});

// ================= INLINE BUTTON HANDLERS =================
bot.on('callback_query', async (callbackQuery) => {
  const action = callbackQuery.data;
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const userId = String(callbackQuery.from.id);
  
  // Handle "Back to Categories"
  if (action === 'back_categories') {
    await bot.deleteMessage(chatId, messageId);
    await bot.sendMessage(
      chatId,
      `🎬 **ALPHA CINEMA** 🎬\n\nSelect a category below:`,
      { parse_mode: "Markdown", ...getFilmCategoryKeyboard() }
    );
    await bot.answerCallbackQuery(callbackQuery.id);
    return;
  }
  
  // Handle Page Navigation
  if (action.startsWith('page_')) {
    const parts = action.split('_');
    const category = parts[1];
    const page = parseInt(parts[2]);
    
    await bot.deleteMessage(chatId, messageId);
    
    const user = await getUser(userId);
    const { items, total, hasMore } = getItemsByCategory(category, page);
    
    const categoryNames = {
      turkish: 'Turkish Series', kdrama: 'K-Drama', anime: 'Anime',
      americanMovies: 'American Movies', americanTV: 'American TV Series',
      indian: 'Indian Movies', arabic: 'Arabic Series',
      korean: 'Korean Movies', japanese: 'Japanese Movies',
      european: 'European Movies'
    };
    const categoryEmojis = {
      turkish: '🇹🇷', kdrama: '🇰🇷', anime: '🎌',
      americanMovies: '🎬', americanTV: '📺', indian: '🇮🇳',
      arabic: '🇦🇪', korean: '🇰🇷', japanese: '🇯🇵',
      european: '🇪🇺'
    };
    
    const title = categoryNames[category] || 'Results';
    const emoji = categoryEmojis[category] || '📚';
    
    await bot.sendMessage(
      chatId,
      `${emoji} *${title}* (${total} titles) - Page ${page + 1}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      { parse_mode: "Markdown" }
    );
    
    for (const item of items) {
      await sendMedia(chatId, item, category);
    }
    
    const navButtons = [];
    if (page > 0) {
      navButtons.push({ text: `⏪ Previous`, callback_data: `page_${category}_${page - 1}` });
    }
    if (hasMore) {
      navButtons.push({ text: `⏩ Next`, callback_data: `page_${category}_${page + 1}` });
    }
    navButtons.push({ text: `🔙 Back to Categories`, callback_data: `back_categories` });
    
    await bot.sendMessage(
      chatId,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📌 *Navigation:*`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [navButtons]
        }
      }
    );
    
    await bot.answerCallbackQuery(callbackQuery.id);
    return;
  }
  
  // Handle Download
  if (action.startsWith('download_')) {
    try {
      const parts = action.split('_');
      const category = parts[1];
      const title = parts.slice(2).join('_');
      
      // Find the item in the category
      const items = getMediaByCategory(category) || [];
      const item = items.find(m => m.title === title);
      
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
      
      await bot.editMessageText(
        `📥 *Downloading: ${item.title}*...\n\n⏳ Please wait, this may take a moment.`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: "Markdown"
        }
      );
      
      await downloadAndSendMedia(chatId, item, category);
      
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
  
  user.filmMode = false;
  await saveUser(user);
  
  await bot.sendMessage(
    chatId,
    `💬 **Chat Mode**\n\n` +
    `Send me any message and I'll respond!\n\n` +
    `💡 Try asking:\n` +
    `• "Explain quantum computing"\n` +
    `• "Write a poem about AI"\n` +
    `• "Help me with my code"\n\n` +
    `✨ *Type your message now!*\n\n` +
    `📌 *To go back to films, click "🎬 Film Download"*`,
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
  
  await bot.sendMessage(
    chatId,
    `📊 **Your Profile**\n\n` +
    `👤 User ID: \`${userId}\`\n` +
    `💎 Plan: ${isPremium ? 'Alpha Pro' : 'Free'}\n` +
    `📊 Messages: ${user.requests || 0}/${DAILY_LIMIT}\n` +
    `📥 Downloads: ${user.downloads || 0}\n` +
    `🪙 Coins: ${user.coins || 0}\n` +
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
      `• Unlimited Film Downloads\n` +
      `• Priority Support\n\n` +
      `*Upgrade now and unlock full power!*`,
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
    `🎬 **Film Download Mode**\n` +
    `• Click "🎬 Film Download" to enter\n` +
    `• Select a category from the buttons\n` +
    `• Browse titles with Next/Previous buttons\n` +
    `• Click "Download" to get files\n` +
    `• Files download directly in Telegram\n` +
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
    `• Unlimited film downloads\n` +
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
    '🔙 Exit Film Mode', '🎬 Film Download', '🇹🇷 Turkish', '🇰🇷 K-Drama',
    '🎌 Anime', '🎬 American Movies', '📺 American TV', '🇮🇳 Indian',
    '🇦🇪 Arabic', '🇰🇷 Korean Movies', '🇯🇵 Japanese', '🇪🇺 European',
    '🎲 Random Pick', '💬 AI Chat', '👑 Developer', '📊 Status',
    '💎 Pro', '🔄 Reset', '❓ Help', '/start', '/menu'
  ];
  
  if (!text || buttonTexts.includes(text) || text.startsWith("/")) {
    return;
  }

  try {
    const user = await getUser(userId);
    
    // If in film mode, ignore text messages
    if (user.filmMode) {
      await bot.sendMessage(
        chatId,
        `🎬 **Film Download Mode**\n\n` +
        `Please use the buttons below to browse and download films.\n\n` +
        `📌 *Select a category to get started!*`,
        { parse_mode: "Markdown", ...getFilmCategoryKeyboard() }
      );
      return;
    }
    
    // ===== AI CHAT MODE =====
    // Check for owner question FIRST - override everything
    if (isOwnerQuestion(text)) {
      await bot.sendMessage(
        chatId,
        `👑 **Alpha AI Pro - Developer**\n\n` +
        `I was created by **${OWNER.name}** (@${OWNER.username}), a passionate Full-Stack Developer and AI Enthusiast.\n\n` +
        `He built me to help people with their questions, provide information, and assist with various tasks.\n\n` +
        `🔗 **Connect with the developer:**\n` +
        `• Telegram: ${OWNER.telegram}\n` +
        `• GitHub: ${OWNER.github}\n` +
        `• Email: ${OWNER.email}\n\n` +
        `❤️ *Built with passion for the community!*`,
        { parse_mode: "Markdown", disable_web_page_preview: true }
      );
      return;
    }
    
    // Check daily limit first
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

    // Store user message
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
      // Use AI with custom system prompt that NEVER mentions Google or other AI teams
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
          `• Unlimited Film Downloads\n` +
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
        <div class="emoji">🎬</div>
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
    const counts = getMediaCount();
    res.json({
      status: "✅ Online",
      users: stats?.totalUsers || 0,
      totalMessages: stats?.totalMessages || 0,
      totalImages: stats?.totalImages || 0,
      totalDownloads: stats?.totalDownloads || 0,
      mediaCount: counts,
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
  const counts = getMediaCount();
  console.log(`🎬 Alpha Cinema Pro Server running on port ${PORT}`);
  console.log(`👑 Developer: ${OWNER.name} (@${OWNER.username})`);
  console.log(`📊 Database: MongoDB`);
  console.log(`📚 Media Library: ${counts.total} titles`);
  await setWebhook();
  console.log(`✅ Bot ready!`);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled Rejection:', error);
});
