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
import { MEDIA_DB } from './mediaDB.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// ================= ADMIN CONFIGURATION =================
const ADMIN_IDS = ["7154361039"];

// ================= DEVELOPER CONFIGURATION =================
const DEVELOPER = {
  name: "Muhammad Ilyas",
  username: "@KING_OF_ALPHA",
  telegram: "https://t.me/KING_OF_ALPHA",
  github: "https://github.com/mamme234",
  email: "ghazimuhammadilyas@gmail.com",
  bio: "Full-Stack Developer | AI Enthusiast | Bot Creator",
  skills: ["JavaScript", "Python", "AI/ML", "Web Development", "Bot Development"],
  achievements: ["Built 50+ Bots", "10k+ Active Users", "AI Innovator", "Alpha Developer"]
};

// ================= DEVELOPER KEYWORDS =================
const DEVELOPER_KEYWORDS = [
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
console.log("GEMINI_API_KEY:", process.env.GEMINI_API_KEY ? "✅ Set" : "❌ Missing");
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
  downloads: { type: Number, default: 0 }
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
      downloads: 0
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
const DAILY_LIMIT = 15;
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
      console.log(`✅ Alpha AI Engine initialized with ${modelName}`);
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

// ================= ATTRACTIVE MEDIA FUNCTIONS =================
function getCategoryEmoji(category) {
  const emojis = {
    'Action': '⚔️',
    'Adventure': '🗺️',
    'Animation': '🎨',
    'Comedy': '😂',
    'Crime': '🔫',
    'Drama': '🎭',
    'Fantasy': '🐉',
    'Horror': '👻',
    'Romance': '❤️',
    'Sci-Fi': '🚀',
    'Thriller': '🔪',
    'Western': '🤠',
    'Historical': '🏰',
    'Family': '👨‍👩‍👧‍👦'
  };
  return emojis[category] || '🎬';
}

function formatMediaCard(item, type) {
  const emoji = type === 'movie' ? '🎬' : type === 'tv' ? '📺' : type === 'kdrama' ? '🇰🇷' : '🇹🇷';
  const typeName = type === 'movie' ? 'Movie' : type === 'tv' ? 'TV Series' : type === 'kdrama' ? 'K-Drama' : 'Turkish Series';
  
  let card = `┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓\n`;
  card += `┃ ${emoji} *${item.title}*\n`;
  card += `┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫\n`;
  card += `┃ 📅 Year: ${item.year}\n`;
  card += `┃ 📋 Type: ${typeName}\n`;
  card += `┃ ⭐ Rating: ${item.rating}/10\n`;
  
  if (item.genre) {
    const genreEmoji = getCategoryEmoji(item.genre);
    card += `┃ 🎭 Genre: ${genreEmoji} ${item.genre}\n`;
  }
  if (item.seasons) {
    card += `┃ 📅 Seasons: ${item.seasons}\n`;
  }
  if (item.episodes) {
    card += `┃ 📅 Episodes: ${item.episodes}\n`;
  }
  
  card += `┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫\n`;
  card += `┃ 📥 [⬇️ Download Now](${item.download})\n`;
  card += `┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`;
  
  return card;
}

function formatMediaList(items, title, emoji) {
  if (items.length === 0) return `❌ No results found.`;
  
  let message = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `   ${emoji} *${title}* (${items.length})\n`;
  message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  
  // Show first 15 items, then "more" button
  const showItems = items.slice(0, 15);
  for (const item of showItems) {
    const type = item.type || 'movie';
    const emojiIcon = type === 'movie' ? '🎬' : type === 'tv' ? '📺' : type === 'kdrama' ? '🇰🇷' : '🇹🇷';
    const genreEmoji = item.genre ? getCategoryEmoji(item.genre) : '';
    
    message += `${emojiIcon} *${item.title}* (${item.year}) ⭐${item.rating}\n`;
    if (item.genre) message += `   ${genreEmoji} ${item.genre}\n`;
    if (item.seasons) message += `   📅 ${item.seasons} Seasons\n`;
    if (item.episodes) message += `   📅 ${item.episodes} Episodes\n`;
    message += `   📥 [Download](${item.download})\n\n`;
  }
  
  if (items.length > 15) {
    message += `_... and ${items.length - 15} more. Use Search to find specific titles._\n`;
  }
  
  return message;
}

function searchMedia(query, type = 'all') {
  const results = [];
  const q = query.toLowerCase();
  
  // Search Movies
  if (type === 'all' || type === 'movies') {
    for (const movie of MEDIA_DB.movies) {
      if (movie.title.toLowerCase().includes(q) || (movie.genre && movie.genre.toLowerCase().includes(q))) {
        results.push({ ...movie, type: 'movie' });
      }
    }
  }
  
  // Search TV Series
  if (type === 'all' || type === 'tv') {
    for (const series of MEDIA_DB.tvSeries) {
      if (series.title.toLowerCase().includes(q)) {
        results.push({ ...series, type: 'tv' });
      }
    }
  }
  
  // Search K-Dramas
  if (type === 'all' || type === 'kdrama') {
    for (const drama of MEDIA_DB.kdramas) {
      if (drama.title.toLowerCase().includes(q)) {
        results.push({ ...drama, type: 'kdrama' });
      }
    }
  }
  
  // Search Turkish Series
  if (type === 'all' || type === 'turkish') {
    for (const series of MEDIA_DB.turkishSeries) {
      if (series.title.toLowerCase().includes(q)) {
        results.push({ ...series, type: 'turkish' });
      }
    }
  }
  
  return results;
}

function getRandomMedia() {
  const all = [
    ...MEDIA_DB.movies.map(m => ({ ...m, type: 'movie' })),
    ...MEDIA_DB.tvSeries.map(m => ({ ...m, type: 'tv' })),
    ...MEDIA_DB.kdramas.map(m => ({ ...m, type: 'kdrama' })),
    ...MEDIA_DB.turkishSeries.map(m => ({ ...m, type: 'turkish' }))
  ];
  return all[Math.floor(Math.random() * all.length)];
}

function getMediaByGenre(genre, type = 'all') {
  const results = [];
  const g = genre.toLowerCase();
  
  const allItems = [
    ...MEDIA_DB.movies.map(m => ({ ...m, type: 'movie' })),
    ...MEDIA_DB.tvSeries.map(m => ({ ...m, type: 'tv' })),
    ...MEDIA_DB.kdramas.map(m => ({ ...m, type: 'kdrama' })),
    ...MEDIA_DB.turkishSeries.map(m => ({ ...m, type: 'turkish' }))
  ];
  
  for (const item of allItems) {
    if (item.genre && item.genre.toLowerCase().includes(g)) {
      results.push(item);
    }
  }
  
  return results;
}

// ================= DEVELOPER INFO =================
function getDeveloperInfo() {
  return `👑 **Alpha AI Pro - Developer**\n\n` +
    `👤 **Name:** ${DEVELOPER.name}\n` +
    `📝 **Username:** ${DEVELOPER.username}\n` +
    `📋 **Bio:** ${DEVELOPER.bio}\n\n` +
    `💻 **Skills:**\n` +
    `${DEVELOPER.skills.map(s => `• ${s}`).join('\n')}\n\n` +
    `🏆 **Achievements:**\n` +
    `${DEVELOPER.achievements.map(a => `• ${a}`).join('\n')}\n\n` +
    `🔗 **Connect:**\n` +
    `• Telegram: ${DEVELOPER.telegram}\n` +
    `• GitHub: ${DEVELOPER.github}\n` +
    `• Email: ${DEVELOPER.email}\n\n` +
    `❤️ *Built with passion for the community!*`;
}

function isDeveloperQuestion(text) {
  const lowerText = text.toLowerCase();
  return DEVELOPER_KEYWORDS.some(keyword => lowerText.includes(keyword));
}

// ================= ATTRACTIVE KEYBOARD BUTTONS =================
function getMainKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '🎬 Movies' }, { text: '📺 TV Series' }, { text: '🇰🇷 K-Drama' }],
        [{ text: '🇹🇷 Turkish Series' }, { text: '🎲 Random Pick' }, { text: '🔍 Search' }],
        [{ text: '⚔️ Action' }, { text: '❤️ Romance' }, { text: '😂 Comedy' }],
        [{ text: '🎭 Drama' }, { text: '🚀 Sci-Fi' }, { text: '👻 Horror' }],
        [{ text: '💬 Chat' }, { text: '👑 Developer' }, { text: '📊 Status' }],
        [{ text: '💎 Pro' }, { text: '🔄 Reset' }, { text: '❓ Help' }]
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    }
  };
}

function getMediaKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '🎬 Movies' }, { text: '📺 TV Series' }, { text: '🇰🇷 K-Drama' }],
        [{ text: '🇹🇷 Turkish Series' }, { text: '🎲 Random Pick' }, { text: '🔍 Search' }],
        [{ text: '🔙 Main Menu' }]
      ],
      resize_keyboard: true
    }
  };
}

function getGenreKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '⚔️ Action' }, { text: '❤️ Romance' }, { text: '😂 Comedy' }],
        [{ text: '🎭 Drama' }, { text: '🚀 Sci-Fi' }, { text: '👻 Horror' }],
        [{ text: '🔙 Main Menu' }]
      ],
      resize_keyboard: true
    }
  };
}

// ================= COMMAND HANDLERS =================

// Main Menu
bot.onText(/\/start|\/menu|🔙 Main Menu/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const user = await getUser(userId);
  const isPremium = user.premium || user.isAdmin;
  const status = isPremium ? '💎 Alpha Pro' : '🆓 Free';
  
  const totalMovies = MEDIA_DB.movies.length;
  const totalTV = MEDIA_DB.tvSeries.length;
  const totalKDrama = MEDIA_DB.kdramas.length;
  const totalTurkish = MEDIA_DB.turkishSeries ? MEDIA_DB.turkishSeries.length : 0;
  const total = totalMovies + totalTV + totalKDrama + totalTurkish;
  
  await bot.sendMessage(
    chatId,
    `🎬 **ALPHA CINEMA** 🎬\n\n` +
    `👤 Status: ${status}\n` +
    `📊 Messages: ${user.requests || 0}\n` +
    `🖼️ Images: ${user.imagesGenerated || 0}\n` +
    `📥 Downloads: ${user.downloads || 0}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📚 **MEDIA LIBRARY**\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🎬 Movies: ${totalMovies}\n` +
    `📺 TV Series: ${totalTV}\n` +
    `🇰🇷 K-Dramas: ${totalKDrama}\n` +
    `🇹🇷 Turkish Series: ${totalTurkish}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📊 Total: ${total} titles\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `💬 *Send any message to chat with AI*\n` +
    `📌 *Use the buttons below to browse:*`,
    { parse_mode: "Markdown", ...getMainKeyboard() }
  );
});

// Movies Button
bot.onText(/🎬 Movies/, async (msg) => {
  const chatId = msg.chat.id;
  const items = MEDIA_DB.movies.map(m => ({ ...m, type: 'movie' }));
  const message = formatMediaList(items, 'Movies Library', '🎬');
  
  await bot.sendMessage(
    chatId,
    message,
    { parse_mode: "Markdown", disable_web_page_preview: true, ...getMediaKeyboard() }
  );
});

// TV Series Button
bot.onText(/📺 TV Series/, async (msg) => {
  const chatId = msg.chat.id;
  const items = MEDIA_DB.tvSeries.map(m => ({ ...m, type: 'tv' }));
  const message = formatMediaList(items, 'TV Series Library', '📺');
  
  await bot.sendMessage(
    chatId,
    message,
    { parse_mode: "Markdown", disable_web_page_preview: true, ...getMediaKeyboard() }
  );
});

// K-Drama Button
bot.onText(/🇰🇷 K-Drama/, async (msg) => {
  const chatId = msg.chat.id;
  const items = MEDIA_DB.kdramas.map(m => ({ ...m, type: 'kdrama' }));
  const message = formatMediaList(items, 'K-Drama Library', '🇰🇷');
  
  await bot.sendMessage(
    chatId,
    message,
    { parse_mode: "Markdown", disable_web_page_preview: true, ...getMediaKeyboard() }
  );
});

// Turkish Series Button
bot.onText(/🇹🇷 Turkish Series/, async (msg) => {
  const chatId = msg.chat.id;
  const items = MEDIA_DB.turkishSeries.map(m => ({ ...m, type: 'turkish' }));
  const message = formatMediaList(items, 'Turkish Series Library', '🇹🇷');
  
  await bot.sendMessage(
    chatId,
    message,
    { parse_mode: "Markdown", disable_web_page_preview: true, ...getMediaKeyboard() }
  );
});

// Search Button
bot.onText(/🔍 Search/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(
    chatId,
    `🔍 **Search Media**\n\n` +
    `Send me a search query like:\n` +
    `• "Godfather" - Search movies\n` +
    `• "Game of Thrones" - Search TV series\n` +
    `• "Squid Game" - Search K-Dramas\n` +
    `• "Diriliş" - Search Turkish series\n` +
    `• "Action" - Search by genre\n\n` +
    `*Type your search query now!*`,
    { parse_mode: "Markdown", ...getMediaKeyboard() }
  );
});

// Random Pick Button
bot.onText(/🎲 Random Pick/, async (msg) => {
  const chatId = msg.chat.id;
  const random = getRandomMedia();
  
  const emojis = { movie: '🎬', tv: '📺', kdrama: '🇰🇷', turkish: '🇹🇷' };
  const types = { movie: 'Movie', tv: 'TV Series', kdrama: 'K-Drama', turkish: 'Turkish Series' };
  
  let message = `🎲 **Random Pick**\n\n`;
  message += `┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓\n`;
  message += `┃ ${emojis[random.type]} *${random.title}*\n`;
  message += `┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫\n`;
  message += `┃ 📅 Year: ${random.year}\n`;
  message += `┃ 📋 Type: ${types[random.type]}\n`;
  message += `┃ ⭐ Rating: ${random.rating}/10\n`;
  
  if (random.genre) {
    const genreEmoji = getCategoryEmoji(random.genre);
    message += `┃ 🎭 Genre: ${genreEmoji} ${random.genre}\n`;
  }
  if (random.seasons) {
    message += `┃ 📅 Seasons: ${random.seasons}\n`;
  }
  if (random.episodes) {
    message += `┃ 📅 Episodes: ${random.episodes}\n`;
  }
  
  message += `┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫\n`;
  message += `┃ 📥 [⬇️ Download Now](${random.download})\n`;
  message += `┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`;
  
  await bot.sendMessage(
    chatId,
    message,
    { parse_mode: "Markdown", disable_web_page_preview: true, ...getMediaKeyboard() }
  );
});

// Genre Buttons
bot.onText(/⚔️ Action/, async (msg) => {
  const chatId = msg.chat.id;
  const results = getMediaByGenre('action');
  if (results.length === 0) {
    await bot.sendMessage(chatId, `❌ No Action titles found.`, { ...getGenreKeyboard() });
    return;
  }
  const message = formatMediaList(results, 'Action Movies & Series', '⚔️');
  await bot.sendMessage(chatId, message, { parse_mode: "Markdown", disable_web_page_preview: true, ...getGenreKeyboard() });
});

bot.onText(/❤️ Romance/, async (msg) => {
  const chatId = msg.chat.id;
  const results = getMediaByGenre('romance');
  if (results.length === 0) {
    await bot.sendMessage(chatId, `❌ No Romance titles found.`, { ...getGenreKeyboard() });
    return;
  }
  const message = formatMediaList(results, 'Romance Movies & Series', '❤️');
  await bot.sendMessage(chatId, message, { parse_mode: "Markdown", disable_web_page_preview: true, ...getGenreKeyboard() });
});

bot.onText(/😂 Comedy/, async (msg) => {
  const chatId = msg.chat.id;
  const results = getMediaByGenre('comedy');
  if (results.length === 0) {
    await bot.sendMessage(chatId, `❌ No Comedy titles found.`, { ...getGenreKeyboard() });
    return;
  }
  const message = formatMediaList(results, 'Comedy Movies & Series', '😂');
  await bot.sendMessage(chatId, message, { parse_mode: "Markdown", disable_web_page_preview: true, ...getGenreKeyboard() });
});

bot.onText(/🎭 Drama/, async (msg) => {
  const chatId = msg.chat.id;
  const results = getMediaByGenre('drama');
  if (results.length === 0) {
    await bot.sendMessage(chatId, `❌ No Drama titles found.`, { ...getGenreKeyboard() });
    return;
  }
  const message = formatMediaList(results, 'Drama Movies & Series', '🎭');
  await bot.sendMessage(chatId, message, { parse_mode: "Markdown", disable_web_page_preview: true, ...getGenreKeyboard() });
});

bot.onText(/🚀 Sci-Fi/, async (msg) => {
  const chatId = msg.chat.id;
  const results = getMediaByGenre('sci-fi');
  if (results.length === 0) {
    await bot.sendMessage(chatId, `❌ No Sci-Fi titles found.`, { ...getGenreKeyboard() });
    return;
  }
  const message = formatMediaList(results, 'Sci-Fi Movies & Series', '🚀');
  await bot.sendMessage(chatId, message, { parse_mode: "Markdown", disable_web_page_preview: true, ...getGenreKeyboard() });
});

bot.onText(/👻 Horror/, async (msg) => {
  const chatId = msg.chat.id;
  const results = getMediaByGenre('horror');
  if (results.length === 0) {
    await bot.sendMessage(chatId, `❌ No Horror titles found.`, { ...getGenreKeyboard() });
    return;
  }
  const message = formatMediaList(results, 'Horror Movies & Series', '👻');
  await bot.sendMessage(chatId, message, { parse_mode: "Markdown", disable_web_page_preview: true, ...getGenreKeyboard() });
});

// Chat Button
bot.onText(/💬 Chat/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(
    chatId,
    `💬 **Chat Mode**\n\n` +
    `Send me any message and I'll respond!\n\n` +
    `💡 Try asking:\n` +
    `• "Explain quantum computing"\n` +
    `• "Write a poem about AI"\n` +
    `• "Help me with my code"\n` +
    `• "Search for a movie called ..."\n\n` +
    `✨ *Type your message now!*`,
    { parse_mode: "Markdown" }
  );
});

// Developer Button
bot.onText(/👑 Developer/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(
    chatId,
    getDeveloperInfo(),
    { parse_mode: "Markdown", disable_web_page_preview: true }
  );
});

// Status Button
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
    `📊 Messages: ${user.requests || 0}\n` +
    `🖼️ Images: ${user.imagesGenerated || 0}\n` +
    `📥 Downloads: ${user.downloads || 0}\n` +
    `🪙 Coins: ${user.coins || 0}\n` +
    `📅 Days Active: ${days}\n\n` +
    `${isPremium ? '🎉 Enjoy unlimited access!' : '💎 Upgrade with the Pro button'}`,
    { parse_mode: "Markdown" }
  );
});

// Pro Button
bot.onText(/💎 Pro/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const user = await getUser(userId);
  
  if (user.isAdmin) {
    await bot.sendMessage(
      chatId,
      `👑 **Admin Access**\n\nYou already have Alpha Pro access!`
    );
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
            description: "Unlimited AI chat, images & media downloads"
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
      `• Unlimited Images\n` +
      `• Unlimited Media Downloads\n` +
      `• Priority Support\n\n` +
      `*Upgrade now and unlock full power!*`,
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    await bot.sendMessage(chatId, "⚠️ Payment system unavailable. Try again later.");
  }
});

// Reset Button
bot.onText(/🔄 Reset/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const user = await getUser(userId);
  user.chatHistory = [];
  await saveUser(user);
  
  await bot.sendMessage(
    chatId,
    `🔄 **Reset Complete!**\n\nFresh start! Send any message.`
  );
});

// Help Button
bot.onText(/❓ Help/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(
    chatId,
    `📖 **Alpha AI Pro - Help**\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🎬 **Media Library**\n` +
    `• Click category buttons to browse\n` +
    `• Use "🔍 Search" to find specific titles\n` +
    `• "🎲 Random Pick" for suggestions\n` +
    `• Genre buttons for quick filtering\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🤖 **AI Chat**\n` +
    `• Click "💬 Chat" or type any message\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💎 **Alpha Pro**\n` +
    `• Click "💎 Pro" to upgrade\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `**Free Limits:**\n` +
    `• 5 messages\n` +
    `• 2 images\n` +
    `• Unlimited media browsing\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `**Alpha Pro:**\n` +
    `• Unlimited everything! 🚀`,
    { parse_mode: "Markdown" }
  );
});

// ================= MESSAGE HANDLER =================
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const text = msg.text;

  // Ignore button texts and commands
  const buttonTexts = [
    '🔙 Main Menu', '🎬 Movies', '📺 TV Series', '🇰🇷 K-Drama',
    '🇹🇷 Turkish Series', '🔍 Search', '🎲 Random Pick',
    '⚔️ Action', '❤️ Romance', '😂 Comedy', '🎭 Drama',
    '🚀 Sci-Fi', '👻 Horror', '💬 Chat', '👑 Developer',
    '📊 Status', '💎 Pro', '🔄 Reset', '❓ Help'
  ];
  
  if (!text || text.startsWith("/") || buttonTexts.includes(text)) {
    return;
  }

  try {
    const user = await getUser(userId);
    
    // Check for developer question
    if (isDeveloperQuestion(text)) {
      await bot.sendMessage(
        chatId,
        getDeveloperInfo(),
        { parse_mode: "Markdown", disable_web_page_preview: true }
      );
      return;
    }
    
    // Check if searching for media
    if (text.toLowerCase().includes('search') || 
        text.toLowerCase().includes('find') ||
        text.toLowerCase().includes('looking for')) {
      
      // Extract search query
      let query = text.replace(/search|find|looking for|for|movie|series|drama|show/i, '').trim();
      if (!query) {
        await bot.sendMessage(
          chatId,
          `🔍 **What are you looking for?**\n\n` +
          `Send me a title or genre to search.\n\n` +
          `Examples:\n` +
          `• "Godfather"\n` +
          `• "Action movies"\n` +
          `• "Turkish series"\n` +
          `• "Romance K-Drama"`,
          { parse_mode: "Markdown" }
        );
        return;
      }
      
      const results = searchMedia(query);
      if (results.length === 0) {
        await bot.sendMessage(
          chatId,
          `❌ No results found for "${query}".\n\n` +
          `Try a different search term or browse by category.`,
          { parse_mode: "Markdown" }
        );
        return;
      }
      
      const message = formatMediaList(results, `Search Results for "${query}"`, '🔍');
      await bot.sendMessage(chatId, message, { parse_mode: "Markdown", disable_web_page_preview: true });
      return;
    }
    
    // Check if it's a media title search
    const results = searchMedia(text);
    if (results.length > 0 && results.length < 10) {
      const message = formatMediaList(results, `Results for "${text}"`, '🔍');
      await bot.sendMessage(chatId, message, { parse_mode: "Markdown", disable_web_page_preview: true });
      return;
    }
    
    // Regular AI chat
    if (!aiReady) {
      await initializeAI();
      if (!aiReady) {
        throw new Error("AI Engine not ready");
      }
    }

    const isPremium = user.premium || user.isAdmin;

    if (!isPremium && user.requests >= 5) {
      await bot.sendMessage(
        chatId,
        `⚠️ **Free limit reached!**\n\n` +
        `You've used 5 free messages.\n` +
        `💎 Upgrade to Alpha Pro for unlimited!\n\n` +
        `Use the "💎 Pro" button.`
      );
      return;
    }

    if (!checkQuota(userId)) {
      await bot.sendMessage(
        chatId,
        `🐺 *Alpha AI Pro is currently at capacity. Please try again in a few minutes.*`
      );
      return;
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

    const result = await aiProcessor.generateContent({
      contents: [{
        role: "user",
        parts: [{ 
          text: `You are Alpha AI Pro, a professional AI assistant. 
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

  } catch (error) {
    console.error("❌ Error:", error.message);
    await bot.sendMessage(
      chatId,
      `⚠️ Error: ${error.message}\n\nPlease try again.`
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
          `• Unlimited Images\n` +
          `• Unlimited Media Downloads\n` +
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
    res.json({
      status: "✅ Online",
      users: stats?.totalUsers || 0,
      totalMessages: stats?.totalMessages || 0,
      totalImages: stats?.totalImages || 0,
      totalDownloads: stats?.totalDownloads || 0
    });
  } catch {
    res.json({
      status: "✅ Online",
      users: Object.keys(fallbackDB.users).length
    });
  }
});

// ================= START SERVER =================
app.listen(PORT, async () => {
  console.log(`🎬 Alpha Cinema Pro Server running on port ${PORT}`);
  console.log(`👑 Admin: ${ADMIN_IDS.join(', ')}`);
  console.log(`📊 Database: MongoDB`);
  console.log(`📚 Media Library:`);
  console.log(`   🎬 Movies: ${MEDIA_DB.movies.length}`);
  console.log(`   📺 TV Series: ${MEDIA_DB.tvSeries.length}`);
  console.log(`   🇰🇷 K-Dramas: ${MEDIA_DB.kdramas.length}`);
  console.log(`   🇹🇷 Turkish Series: ${MEDIA_DB.turkishSeries ? MEDIA_DB.turkishSeries.length : 0}`);
  console.log(`   📊 Total: ${MEDIA_DB.movies.length + MEDIA_DB.tvSeries.length + MEDIA_DB.kdramas.length + (MEDIA_DB.turkishSeries ? MEDIA_DB.turkishSeries.length : 0)} titles`);
  await setWebhook();
  console.log(`✅ Bot ready!`);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled Rejection:', error);
});
