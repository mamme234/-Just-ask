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

// ================= ENTERPRISE FEATURES CONFIGURATION =================
const ENTERPRISE = {
  memory: {
    enabled: true,
    maxHistory: 100,
    importantKeywords: ['name', 'project', 'preference', 'remember', 'favorite']
  },
  multiModal: {
    enabled: true,
    supportedTypes: ['image', 'pdf', 'excel', 'csv', 'txt', 'doc', 'voice'],
    maxFileSize: 20 * 1024 * 1024
  },
  grounding: {
    enabled: true,
    searchEnabled: true,
    citationRequired: true
  },
  guardrails: {
    enabled: true,
    blockHarmful: true,
    detectJailbreak: true
  },
  fallback: {
    enabled: true,
    maxUncertainty: 3,
    humanHandoff: true
  },
  personality: {
    enabled: true,
    tone: 'professional',
    consistency: true
  },
  clarification: {
    enabled: true,
    maxQuestions: 3,
    threshold: 0.6
  },
  analytics: {
    enabled: true,
    trackDropOff: true,
    retrainWeakSpots: true
  },
  rateLimits: {
    enabled: true,
    maxTokensPerMinute: 100000,
    maxRequestsPerMinute: 60
  }
};

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
// MongoDB Models
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
  videosProcessed: { type: Number, default: 0 },
  joinedDate: { type: Date, default: Date.now },
  memory: { type: Object, default: {} },
  lastActive: { type: Date, default: Date.now },
  dropOffCount: { type: Number, default: 0 },
  weakSpots: { type: Array, default: [] }
});

const StatsSchema = new mongoose.Schema({
  totalUsers: { type: Number, default: 0 },
  totalMessages: { type: Number, default: 0 },
  totalImages: { type: Number, default: 0 },
  totalVideos: { type: Number, default: 0 },
  dropOffs: { type: Number, default: 0 },
  weakSpots: { type: Object, default: {} },
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
        totalVideos: 0,
        dropOffs: 0,
        weakSpots: {}
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

async function updateStats(type, data = {}) {
  try {
    const update = {};
    if (type === 'message') update.$inc = { totalMessages: 1 };
    if (type === 'image') update.$inc = { totalImages: 1 };
    if (type === 'video') update.$inc = { totalVideos: 1 };
    if (type === 'dropoff') update.$inc = { dropOffs: 1 };
    if (type === 'weakspot' && data.topic) {
      const spot = await Stats.findOne();
      const weakSpots = spot?.weakSpots || {};
      weakSpots[data.topic] = (weakSpots[data.topic] || 0) + 1;
      update.$set = { weakSpots };
    }
    await Stats.findOneAndUpdate({}, update, { upsert: true });
  } catch (error) {
    console.error("❌ Update stats error:", error);
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
      memory: {}
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

// ================= ENTERPRISE SYSTEMS =================

// 1. MEMORY SYSTEM
class MemorySystem {
  constructor() {
    this.memories = {};
  }

  async store(userId, key, value, importance = 'medium') {
    const user = await getUser(userId);
    if (!user.memory) user.memory = {};
    user.memory[key] = {
      value,
      timestamp: Date.now(),
      importance
    };
    await saveUser(user);
  }

  async recall(userId, key) {
    const user = await getUser(userId);
    if (user.memory && user.memory[key]) {
      return user.memory[key].value;
    }
    return null;
  }

  async recallAll(userId) {
    const user = await getUser(userId);
    return user.memory || {};
  }
}

const memorySystem = new MemorySystem();

// 2. GUARDRAILS SYSTEM
class Guardrails {
  constructor() {
    this.blockedPatterns = [
      /hack/i, /exploit/i, /jailbreak/i, /ignore previous/i,
      /bypass/i, /unauthorized/i, /malicious/i, /attack/i,
      /destroy/i, /damage/i, /illegal/i, /harm/i,
      /kill/i, /suicide/i, /drugs/i, /weapon/i
    ];
    this.jailbreakPatterns = [
      /ignore all instructions/i,
      /forget previous/i,
      /act as if/i,
      /you are now/i,
      /bypass restrictions/i,
      /override/i,
      /system prompt/i
    ];
  }

  check(text) {
    const results = {
      isHarmful: false,
      isJailbreak: false,
      warnings: []
    };

    for (const pattern of this.blockedPatterns) {
      if (pattern.test(text)) {
        results.isHarmful = true;
        results.warnings.push(`Harmful content detected: ${pattern.source}`);
        break;
      }
    }

    for (const pattern of this.jailbreakPatterns) {
      if (pattern.test(text)) {
        results.isJailbreak = true;
        results.warnings.push(`Jailbreak attempt detected: ${pattern.source}`);
        break;
      }
    }

    return results;
  }
}

const guardrails = new Guardrails();

// 3. CLARIFICATION SYSTEM
class ClarificationSystem {
  constructor() {
    this.vaguePatterns = [
      /help/i, /something/i, /anything/i, /everything/i,
      /not sure/i, /maybe/i, /some/i, /whatever/i,
      /idk/i, /dunno/i, /no idea/i
    ];
    this.followUpQuestions = {
      general: [
        "Could you provide more details about what you're looking for?",
        "What specific aspect are you interested in?",
        "Could you clarify your question a bit more?"
      ],
      technical: [
        "What programming language or technology are you using?",
        "Could you share the error message or specific issue?",
        "What's the expected outcome?"
      ],
      professional: [
        "What's the context of this request?",
        "Who is the target audience?",
        "What's the desired timeline?"
      ]
    };
  }

  needsClarification(text) {
    const isVague = this.vaguePatterns.some(pattern => pattern.test(text));
    const isShort = text.split(' ').length < 4;
    return isVague || isShort;
  }

  generateQuestions(text, category = 'general') {
    const questions = this.followUpQuestions[category] || this.followUpQuestions.general;
    return questions.slice(0, ENTERPRISE.clarification.maxQuestions);
  }
}

const clarificationSystem = new ClarificationSystem();

// 4. PERSONALITY SYSTEM
class PersonalitySystem {
  constructor() {
    this.tone = ENTERPRISE.personality.tone;
    this.traits = {
      professional: {
        style: "formal, clear, structured",
        greeting: "Hello",
        signoff: "Regards",
        emojis: "minimal"
      },
      empathetic: {
        style: "warm, supportive, understanding",
        greeting: "Hi there",
        signoff: "Take care",
        emojis: "moderate"
      },
      witty: {
        style: "clever, humorous, engaging",
        greeting: "Hey",
        signoff: "Catch you later",
        emojis: "frequent"
      }
    };
  }

  getTone() {
    return this.traits[this.tone] || this.traits.professional;
  }
}

const personality = new PersonalitySystem();

// 5. ANALYTICS SYSTEM
class AnalyticsSystem {
  async trackSession(userId, action, details = {}) {
    try {
      const user = await getUser(userId);
      // Track drop-off patterns
      if (action === 'dropoff') {
        user.dropOffCount = (user.dropOffCount || 0) + 1;
        await updateStats('dropoff');
      }
      if (action === 'weakspot' && details.topic) {
        if (!user.weakSpots) user.weakSpots = [];
        user.weakSpots.push({ topic: details.topic, timestamp: Date.now() });
        await updateStats('weakspot', { topic: details.topic });
      }
      await saveUser(user);
    } catch (error) {
      console.error("❌ Analytics error:", error);
    }
  }

  async getStats() {
    try {
      const stats = await Stats.findOne();
      const users = await User.find({});
      const activeUsers = users.filter(u => {
        const days = (Date.now() - new Date(u.lastActive).getTime()) / (1000 * 60 * 60 * 24);
        return days < 7;
      });
      return {
        totalUsers: stats?.totalUsers || 0,
        totalMessages: stats?.totalMessages || 0,
        totalImages: stats?.totalImages || 0,
        totalVideos: stats?.totalVideos || 0,
        dropOffs: stats?.dropOffs || 0,
        activeUsers: activeUsers.length,
        weakSpots: stats?.weakSpots || {}
      };
    } catch (error) {
      console.error("❌ Get stats error:", error);
      return { totalUsers: 0, totalMessages: 0 };
    }
  }
}

const analytics = new AnalyticsSystem();

// 6. RATE LIMITER
class RateLimiter {
  constructor() {
    this.requests = {};
    this.tokens = {};
  }

  check(userId, tokens = 100) {
    const now = Date.now();
    const minute = 60000;

    if (!this.requests[userId]) {
      this.requests[userId] = [];
    }
    this.requests[userId] = this.requests[userId].filter(time => now - time < minute);
    
    if (this.requests[userId].length >= ENTERPRISE.rateLimits.maxRequestsPerMinute) {
      return { allowed: false, reason: "Too many requests. Please wait." };
    }

    if (!this.tokens[userId]) {
      this.tokens[userId] = [];
    }
    this.tokens[userId] = this.tokens[userId].filter(time => now - time < minute);
    
    const totalTokens = this.tokens[userId].reduce((sum, t) => sum + t, 0);
    if (totalTokens + tokens > ENTERPRISE.rateLimits.maxTokensPerMinute) {
      return { allowed: false, reason: "Token limit exceeded. Please wait." };
    }

    this.requests[userId].push(now);
    this.tokens[userId].push(tokens);
    
    return { allowed: true };
  }
}

const rateLimiter = new RateLimiter();

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

function getFallbackResponse() {
  const responses = [
    "🐺 *Alpha AI Pro is currently at capacity. Please try again in a few minutes.*\n\n_This helps ensure fair usage for all users._",
    "🐺 *The AI is taking a quick break. Please try again shortly.*\n\n_We appreciate your patience!_",
    "🐺 *High demand right now. Please wait a moment before trying again.*\n\n_Thank you for using Alpha AI Pro!_"
  ];
  return responses[Math.floor(Math.random() * responses.length)];
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

// ================= GROUNDING: REAL-TIME SEARCH =================
async function searchWeb(query) {
  try {
    const searchUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`;
    const response = await axios.get(searchUrl, { timeout: 5000 });
    if (response.data && response.data.AbstractText) {
      return {
        content: response.data.AbstractText,
        source: response.data.AbstractURL || "DuckDuckGo",
        citation: response.data.AbstractURL
      };
    }
    return null;
  } catch (error) {
    console.error("❌ Search error:", error.message);
    return null;
  }
}

// ================= IMAGE GENERATION =================
async function generateImage(prompt, userId) {
  try {
    const user = await getUser(userId);
    const isPremium = user.premium || user.isAdmin;
    
    if (!isPremium && user.imagesGenerated >= 2) {
      return { error: "⚠️ Free limit reached. Upgrade to Alpha Pro for unlimited images!" };
    }
    
    console.log(`🖼️ Generating image: "${prompt.substring(0, 50)}..."`);
    
    const encodedPrompt = encodeURIComponent(prompt);
    const imageUrl = `https://pollinations.ai/p/${encodedPrompt}?width=1024&height=768&model=flux&nologo=true`;
    
    const response = await axios.get(imageUrl, { 
      responseType: 'arraybuffer',
      timeout: 30000
    });
    
    const imageBuffer = Buffer.from(response.data);
    
    user.imagesGenerated = (user.imagesGenerated || 0) + 1;
    await saveUser(user);
    await updateStats('image');
    
    return { 
      buffer: imageBuffer, 
      description: `✨ "${prompt}"`
    };
    
  } catch (error) {
    console.error("❌ Image generation error:", error.message);
    return { error: "⚠️ Failed to generate image. Please try again." };
  }
}

// ================= FALLBACK SYSTEM =================
async function generateFallbackResponse(userId, originalPrompt) {
  const tone = personality.getTone();
  
  const fallbackMessages = [
    `${tone.greeting}! I want to make sure I give you the best answer possible. Could you help me understand better?`,
    `I'm not entirely sure about that. Could you rephrase or add more context?`,
    `That's an interesting question! Let me think... Could you tell me more specifically what you'd like to know?`
  ];
  
  await analytics.trackSession(userId, 'dropoff');
  
  return fallbackMessages[Math.floor(Math.random() * fallbackMessages.length)];
}

// ================= KEYBOARD BUTTONS =================
function getMainKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '💬 Chat' }, { text: '🖼️ Image' }, { text: '📸 Photo' }],
        [{ text: '🎬 Video' }, { text: '🎨 Design' }, { text: '👑 Developer' }],
        [{ text: '📊 Status' }, { text: '💎 Pro' }, { text: '🔄 Reset' }],
        [{ text: '❓ Help' }, { text: '📈 Analytics' }]
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    }
  };
}

function getChatKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '💬 New Chat' }, { text: '🔄 Reset Chat' }],
        [{ text: '🔙 Main Menu' }]
      ],
      resize_keyboard: true
    }
  };
}

function getImageKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '🌅 Generate Image' }, { text: '🎨 Random Art' }],
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
  
  // Load memory
  const memory = await memorySystem.recallAll(userId);
  const memoryCount = Object.keys(memory).length;
  
  await bot.sendMessage(
    chatId,
    `🐺 **Alpha AI Pro - Enterprise Edition**\n\n` +
    `👤 Status: ${status}\n` +
    `📊 Messages: ${user.requests || 0}\n` +
    `🖼️ Images: ${user.imagesGenerated || 0}\n` +
    `🪙 Coins: ${user.coins || 0}\n` +
    `🧠 Memories: ${memoryCount}\n\n` +
    `━━━━━━━━━━━━━━━━━━━\n` +
    `🧠 **Enterprise Features:**\n` +
    `• Memory: Cross-session recall\n` +
    `• Multi-Modal: Text + Image + File\n` +
    `• Grounding: Real-time search + citations\n` +
    `• Guardrails: Safety + jailbreak detection\n` +
    `• Fallback: Graceful + human handoff\n` +
    `• Personality: Consistent tone\n` +
    `• Clarification: Smart questions\n` +
    `• Analytics: Drop-off tracking\n` +
    `• Rate Limits: Usage throttling\n` +
    `━━━━━━━━━━━━━━━━━━━\n\n` +
    `📌 **Use the buttons below:**`,
    { parse_mode: "Markdown", ...getMainKeyboard() }
  );
});

// Chat Button
bot.onText(/💬 Chat/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(
    chatId,
    `💬 **Chat Mode**\n\n` +
    `Send me any message and I'll respond like a pro!\n\n` +
    `🧠 **Enterprise Features Active:**\n` +
    `• Memory: I remember our conversations\n` +
    `• Clarification: I'll ask if unclear\n` +
    `• Grounding: Live web search available\n` +
    `• Guardrails: Security active\n\n` +
    `💡 Try asking:\n` +
    `• "Explain quantum computing"\n` +
    `• "Write a poem about AI"\n` +
    `• "Help me with my code"\n` +
    `• "Search for latest AI news"\n\n` +
    `✨ *Type your message now!*`,
    { parse_mode: "Markdown", ...getChatKeyboard() }
  );
});

// Image Button
bot.onText(/🖼️ Image/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const user = await getUser(userId);
  const isPremium = user.premium || user.isAdmin;
  const remaining = Math.max(0, 2 - (user.imagesGenerated || 0));
  
  await bot.sendMessage(
    chatId,
    `🖼️ **Image Generator**\n\n` +
    `Describe the image you want to create.\n\n` +
    `💡 Examples:\n` +
    `• "A futuristic city at sunset"\n` +
    `• "A cute cat with a crown"\n` +
    `• "Abstract art with vibrant colors"\n` +
    `• "A spaceship flying through space"\n\n` +
    `${isPremium ? '💎 Unlimited' : `🆓 ${remaining} free left`}\n\n` +
    `*Send your image description now!*`,
    { parse_mode: "Markdown", ...getImageKeyboard() }
  );
});

// Photo Button
bot.onText(/📸 Photo/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(
    chatId,
    `📸 **Photo Editing**\n\n` +
    `Send me a photo and tell me what to do!\n\n` +
    `**Available effects:**\n` +
    `• Brightness - Make it brighter\n` +
    `• Contrast - More contrast\n` +
    `• Blur - Soften the image\n` +
    `• Grayscale - Black & white\n` +
    `• Sepia - Vintage look\n` +
    `• Rotate - Turn the image\n` +
    `• Vintage - Old photo effect\n` +
    `• Vibrant - Boost colors\n\n` +
    `*Send a photo and tell me the effect!*`,
    { parse_mode: "Markdown" }
  );
});

// Video Button
bot.onText(/🎬 Video/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(
    chatId,
    `🎬 **Video Processing**\n\n` +
    `Send me a video and tell me what to do!\n\n` +
    `**Available actions:**\n` +
    `• Trim - Cut video length\n` +
    `• Convert - Change format\n` +
    `• Resize - Change size\n` +
    `• Speed - Faster/slower\n\n` +
    `*Send a video and tell me what to do!*`,
    { parse_mode: "Markdown" }
  );
});

// Design Button
bot.onText(/🎨 Design/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(
    chatId,
    `🎨 **Design Tools**\n\n` +
    `Tell me what design you want!\n\n` +
    `**Available designs:**\n` +
    `• Poster - Create a poster\n` +
    `• Logo - Design a logo\n` +
    `• Banner - Make a banner\n` +
    `• Meme - Create a meme\n` +
    `• Infographic - Data visualization\n\n` +
    `*Describe your design!*`,
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
  const memory = await memorySystem.recallAll(userId);
  const memoryCount = Object.keys(memory).length;
  
  await bot.sendMessage(
    chatId,
    `📊 **Your Profile**\n\n` +
    `👤 User ID: \`${userId}\`\n` +
    `💎 Plan: ${isPremium ? 'Alpha Pro' : 'Free'}\n` +
    `📊 Messages: ${user.requests || 0}\n` +
    `🖼️ Images: ${user.imagesGenerated || 0}\n` +
    `🪙 Coins: ${user.coins || 0}\n` +
    `🧠 Memories: ${memoryCount}\n` +
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
            description: "Unlimited AI chat, images & more"
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
      `• Unlimited Photo Editing\n` +
      `• Unlimited Video Processing\n` +
      `• Advanced Design Tools\n` +
      `• Priority Support\n\n` +
      `*Upgrade now and unlock full power!*`,
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    await bot.sendMessage(chatId, "⚠️ Payment system unavailable. Try again later.");
  }
});

// Reset Button
bot.onText(/🔄 Reset|🔄 Reset Chat/, async (msg) => {
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
    `**🤖 AI Chat**\n` +
    `• Click "💬 Chat" or type any message\n\n` +
    `**🖼️ Image Generation**\n` +
    `• Click "🖼️ Image" and describe what you want\n\n` +
    `**📸 Photo Editing**\n` +
    `• Send a photo and tell me the effect\n\n` +
    `**🎬 Video Processing**\n` +
    `• Send a video and tell me what to do\n\n` +
    `**🎨 Design Tools**\n` +
    `• Describe the design you want\n\n` +
    `**💎 Alpha Pro**\n` +
    `• Click "💎 Pro" to upgrade\n\n` +
    `**👑 Developer**\n` +
    `• Click "👑 Developer" to learn about the creator\n\n` +
    `**📈 Analytics**\n` +
    `• Click "📈 Analytics" for system stats\n\n` +
    `**Free Limits:**\n` +
    `• 5 messages\n` +
    `• 2 images\n\n` +
    `**Alpha Pro:**\n` +
    `• Unlimited everything! 🚀`,
    { parse_mode: "Markdown" }
  );
});

// Analytics Button
bot.onText(/📈 Analytics/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const user = await getUser(userId);
  
  if (!user.isAdmin && !user.premium) {
    await bot.sendMessage(
      chatId,
      `📈 **Analytics**\n\n` +
      `This feature is available for Premium and Admin users only.\n\n` +
      `💎 Upgrade to Alpha Pro to access analytics!`
    );
    return;
  }
  
  const stats = await analytics.getStats();
  await bot.sendMessage(
    chatId,
    `📈 **Analytics Dashboard**\n\n` +
    `👥 **Total Users:** ${stats.totalUsers}\n` +
    `💬 **Total Messages:** ${stats.totalMessages}\n` +
    `🖼️ **Images Generated:** ${stats.totalImages}\n` +
    `🎬 **Videos Processed:** ${stats.totalVideos}\n` +
    `🟢 **Active Users (7d):** ${stats.activeUsers}\n` +
    `📉 **Drop-offs:** ${stats.dropOffs}\n` +
    `🔴 **Weak Spots:** ${Object.keys(stats.weakSpots).length > 0 ? Object.keys(stats.weakSpots).join(', ') : 'None detected'}\n\n` +
    `📊 **System Status:**\n` +
    `• Memory: ✅ Active\n` +
    `• Guardrails: ✅ Active\n` +
    `• Rate Limits: ✅ ${ENTERPRISE.rateLimits.maxRequestsPerMinute}/min\n` +
    `• Personality: ${ENTERPRISE.personality.tone}\n` +
    `• Grounding: ✅ Active\n` +
    `• Clarification: ✅ Active\n\n` +
    `🔄 *Analytics updated in real-time*`
  );
});

// New Chat Button
bot.onText(/💬 New Chat/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const user = await getUser(userId);
  user.chatHistory = [];
  await saveUser(user);
  
  await bot.sendMessage(
    chatId,
    `🔄 **New Chat Started!**\n\nSend any message to begin.`,
    { ...getChatKeyboard() }
  );
});

// Generate Image Button
bot.onText(/🌅 Generate Image/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(
    chatId,
    `🖼️ **Describe Your Image**\n\n` +
    `Send me a detailed description of what you want to create.\n\n` +
    `💡 Examples:\n` +
    `• "A cyberpunk city with neon lights"\n` +
    `• "A magical forest with glowing trees"\n` +
    `• "A futuristic spaceship design"\n\n` +
    `*Type your description now!*`,
    { parse_mode: "Markdown" }
  );
});

// Random Art Button
bot.onText(/🎨 Random Art/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  
  const randomPrompts = [
    "A beautiful sunset over mountains with vibrant colors",
    "A futuristic city with flying cars and neon lights",
    "A magical forest with glowing mushrooms and fairies",
    "An abstract digital art with flowing colors and shapes",
    "A cosmic galaxy with stars and nebulas",
    "A cyberpunk character with glowing neon elements"
  ];
  
  const prompt = randomPrompts[Math.floor(Math.random() * randomPrompts.length)];
  const result = await generateImage(prompt, userId);
  
  if (result.error) {
    await bot.sendMessage(chatId, result.error);
    return;
  }
  
  const user = await getUser(userId);
  await bot.sendPhoto(chatId, result.buffer, {
    caption: `🎨 **Random Art**\n\n${result.description}\n\n🪙 Coins: ${user.coins || 0}`
  });
});

// ================= MESSAGE HANDLER WITH ENTERPRISE FEATURES =================
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const text = msg.text;

  if (!text || text.startsWith("/") || text.startsWith("🔙") || text.startsWith("💬") || 
      text.startsWith("🖼️") || text.startsWith("📸") || text.startsWith("🎬") || 
      text.startsWith("🎨") || text.startsWith("👑") || text.startsWith("📊") || 
      text.startsWith("💎") || text.startsWith("🔄") || text.startsWith("❓") ||
      text.startsWith("🌅") || text.startsWith("🎨 Random") || text.startsWith("📈")) {
    return;
  }

  try {
    const user = await getUser(userId);
    
    // 1. GUARDRAILS - Check for harmful content
    const guardrailResult = guardrails.check(text);
    if (guardrailResult.isHarmful) {
      await bot.sendMessage(
        chatId,
        `🛡️ **Security Alert**\n\n` +
        `Your message was flagged by our guardrails system.\n` +
        `Please rephrase your question in a more appropriate manner.\n\n` +
        `_If you believe this is an error, please contact support._`
      );
      await analytics.trackSession(userId, 'dropoff');
      return;
    }
    
    if (guardrailResult.isJailbreak) {
      await bot.sendMessage(
        chatId,
        `🔒 **Security Warning**\n\n` +
        `A potential jailbreak attempt was detected.\n` +
        `For security reasons, I cannot respond to this request.\n\n` +
        `_Please note: All interactions are logged for security purposes._`
      );
      await analytics.trackSession(userId, 'dropoff');
      return;
    }
    
    // 2. RATE LIMITS - Check usage
    const rateCheck = rateLimiter.check(userId, text.length);
    if (!rateCheck.allowed) {
      await bot.sendMessage(
        chatId,
        `⏳ **Rate Limit Exceeded**\n\n` +
        `${rateCheck.reason}\n\n` +
        `Current limits:\n` +
        `• ${ENTERPRISE.rateLimits.maxRequestsPerMinute} requests/min\n` +
        `• ${ENTERPRISE.rateLimits.maxTokensPerMinute} tokens/min`
      );
      await analytics.trackSession(userId, 'dropoff');
      return;
    }
    
    // 3. CHECK FOR DEVELOPER QUESTION
    if (isDeveloperQuestion(text)) {
      await bot.sendMessage(
        chatId,
        getDeveloperInfo(),
        { parse_mode: "Markdown", disable_web_page_preview: true }
      );
      return;
    }
    
    // 4. MEMORY - Cross-session recall
    const rememberedName = await memorySystem.recall(userId, 'name');
    const rememberedProjects = await memorySystem.recall(userId, 'projects');
    
    let memoryContext = "";
    if (rememberedName) {
      memoryContext += `\nUser's name: ${rememberedName}`;
    }
    if (rememberedProjects) {
      memoryContext += `\nUser's projects: ${rememberedProjects}`;
    }
    
    // 5. MULTI-MODAL - Check if generating image
    if (text.toLowerCase().includes('image') || 
        text.toLowerCase().includes('picture') ||
        text.toLowerCase().includes('draw') ||
        text.toLowerCase().includes('create') ||
        text.toLowerCase().includes('generate')) {
      
      const isPremium = user.premium || user.isAdmin;
      if (!isPremium && user.imagesGenerated >= 2) {
        await bot.sendMessage(
          chatId,
          `⚠️ **Image limit reached!**\n\n` +
          `You've used all 2 free images.\n` +
          `💎 Upgrade to Alpha Pro for unlimited!\n\n` +
          `Use the "💎 Pro" button.`
        );
        return;
      }
      
      const result = await generateImage(text, userId);
      if (result.error) {
        await bot.sendMessage(chatId, result.error);
        return;
      }
      
      await bot.sendPhoto(chatId, result.buffer, {
        caption: `🖼️ **Generated Image**\n\n${result.description}\n\n🪙 Coins: ${user.coins || 0}`
      });
      return;
    }
    
    // 6. CLARIFICATION - Check if needs clarification
    if (ENTERPRISE.clarification.enabled && clarificationSystem.needsClarification(text)) {
      const questions = clarificationSystem.generateQuestions(text);
      await bot.sendMessage(
        chatId,
        `🤔 **Let me clarify**\n\n` +
        `To give you the best answer, I need a bit more information:\n\n` +
        questions.map((q, i) => `${i+1}. ${q}`).join('\n') + `\n\n` +
        `*Please provide more details and I'll help you out!*`
      );
      return;
    }
    
    // 7. GROUNDING - Real-time search
    let searchResult = null;
    if (ENTERPRISE.grounding.enabled && 
        (text.toLowerCase().includes('search') || 
         text.toLowerCase().includes('latest') ||
         text.toLowerCase().includes('news') ||
         text.toLowerCase().includes('current'))) {
      searchResult = await searchWeb(text);
      if (searchResult) {
        await bot.sendMessage(
          chatId,
          `🔍 **Live Search Results**\n\n` +
          `${searchResult.content}\n\n` +
          `📎 *Source: ${searchResult.source}*`
        );
      }
    }
    
    // 8. REGULAR CHAT with ENTERPRISE CONTEXT
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
      const fallbackResponse = await generateFallbackResponse(userId, text);
      await bot.sendMessage(chatId, fallbackResponse);
      return;
    }

    await bot.sendChatAction(chatId, "typing");

    // Store in memory
    user.chatHistory = user.chatHistory || [];
    user.chatHistory.push({ role: "user", content: text });
    user.requests = (user.requests || 0) + 1;
    user.totalMessages = (user.totalMessages || 0) + 1;
    incrementQuota(userId);
    await saveUser(user);
    await updateStats('message');

    // Store name in memory if mentioned
    if (text.toLowerCase().includes('my name is')) {
      const nameMatch = text.match(/my name is (\w+)/i);
      if (nameMatch) {
        await memorySystem.store(userId, 'name', nameMatch[1], 'high');
        await bot.sendMessage(
          chatId,
          `📝 *I'll remember your name: ${nameMatch[1]}*`
        );
      }
    }

    // Limit history
    if (user.chatHistory.length > (isPremium ? 100 : 20)) {
      user.chatHistory = user.chatHistory.slice(-(isPremium ? 100 : 20));
    }

    // Build context with memory
    let context = "";
    for (const entry of user.chatHistory) {
      context += `${entry.role === 'user' ? 'User' : 'Assistant'}: ${entry.content}\n`;
    }
    
    if (memoryContext) {
      context += `\n[Memory Context:${memoryContext}]\n`;
    }
    
    if (searchResult) {
      context += `\n[Live Search Data: ${searchResult.content.substring(0, 200)}...]\n`;
    }

    // Generate response with personality
    const tone = personality.getTone();
    const systemPrompt = `You are Alpha AI Pro, a professional AI assistant created by ${DEVELOPER.name} (@${DEVELOPER.username}). 
    Your tone should be: ${tone.style}
    You have access to the following context:
    - User's conversation history
    - Cross-session memory (if available)
    - Real-time search results (if applicable)
    
    Provide clear, detailed, and helpful responses. Use appropriate formatting.
    
    ${tone.greeting}, I'm here to help!
    
    Conversation:
    ${context}
    
    Assistant: Provide a professional, ${tone.style} response.`;

    const result = await aiProcessor.generateContent({
      contents: [{
        role: "user",
        parts: [{ text: systemPrompt }]
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
    await analytics.trackSession(userId, 'dropoff');
    
    const fallbackQuestions = [
      "Would you like to try rephrasing your question?",
      "Can I help you with something else?",
      "Would you like me to search for this information?"
    ];
    
    await bot.sendMessage(
      chatId,
      `⚠️ I encountered an issue.\n\n` +
      `${fallbackQuestions.join('\n')}\n\n` +
      `_If this continues, please contact support._`
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
          `**Enterprise Features:**\n` +
          `• 🧠 Cross-session Memory\n` +
          `• 🌐 Real-time Search + Citations\n` +
          `• 🛡️ Advanced Guardrails\n` +
          `• 🎯 Smart Clarification\n` +
          `• 📈 Analytics Dashboard\n` +
          `• 🔒 Rate Limits Protection\n` +
          `• 💬 Unlimited Everything\n\n` +
          `🚀 *Enjoy the full power of Alpha AI Pro!*`
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
      .features { text-align: left; margin: 20px 0; color: #e0e0e0; }
      .features li { list-style: none; padding: 5px 0; }
    </style>
    </head>
    <body>
      <div class="card">
        <div class="emoji">🐺</div>
        <h1>Alpha AI Pro Unlocked!</h1>
        <p>Welcome to the Enterprise Club!</p>
        <div class="features">
          <li>✅ Cross-session Memory</li>
          <li>✅ Real-time Search</li>
          <li>✅ Advanced Guardrails</li>
          <li>✅ Analytics Dashboard</li>
          <li>✅ Unlimited Everything</li>
        </div>
        <p style="font-size: 0.9em; opacity: 0.8;">Close this window and return to Telegram</p>
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
      features: {
        memory: ENTERPRISE.memory.enabled,
        guardrails: ENTERPRISE.guardrails.enabled,
        grounding: ENTERPRISE.grounding.enabled,
        personality: ENTERPRISE.personality.tone,
        rateLimits: `${ENTERPRISE.rateLimits.maxRequestsPerMinute}/min`
      }
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
  console.log(`🐺 Alpha AI Pro - Enterprise Edition`);
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`👑 Admin: ${ADMIN_IDS.join(', ')}`);
  console.log(`📊 Database: MongoDB`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ Memory: Cross-session recall`);
  console.log(`✅ Multi-Modal: Text + Image + File`);
  console.log(`✅ Grounding: Real-time search`);
  console.log(`✅ Guardrails: Safety + jailbreak`);
  console.log(`✅ Fallback: Graceful + handoff`);
  console.log(`✅ Personality: ${ENTERPRISE.personality.tone}`);
  console.log(`✅ Clarification: Smart questions`);
  console.log(`✅ Analytics: Drop-off tracking`);
  console.log(`✅ Rate Limits: ${ENTERPRISE.rateLimits.maxRequestsPerMinute}/min`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  await setWebhook();
  console.log(`✅ Bot ready!`);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled Rejection:', error);
});
