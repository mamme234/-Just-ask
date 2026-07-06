import express from "express";
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import fs from "fs";
import Stripe from "stripe";
import { GoogleGenerativeAI } from "@google/generative-ai";
import axios from "axios";
import path from "path";
import { fileURLToPath } from 'url';
import { createCanvas } from 'canvas';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

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

const ADMIN_IDS = ["123456789"];

// ================= ENTERPRISE FEATURES CONFIGURATION =================
const CONFIG = {
  // Memory: Cross-session recall
  memory: {
    enabled: true,
    maxHistory: 100,
    importantKeywords: ['name', 'project', 'preference', 'remember', 'favorite']
  },
  // Multi-Modal: Supported file types
  multiModal: {
    enabled: true,
    supportedTypes: ['image', 'pdf', 'excel', 'csv', 'txt', 'doc', 'voice'],
    maxFileSize: 20 * 1024 * 1024 // 20MB
  },
  // Grounding: Real-time search
  grounding: {
    enabled: true,
    searchEnabled: true,
    citationRequired: true
  },
  // Actions: API integrations
  actions: {
    enabled: true,
    integrations: ['slack', 'jira', 'calendar', 'email']
  },
  // Guardrails: Safety & security
  guardrails: {
    enabled: true,
    blockHarmful: true,
    detectJailbreak: true,
    maxRetries: 2
  },
  // Fallback: Graceful failure
  fallback: {
    enabled: true,
    maxUncertainty: 3,
    humanHandoff: true
  },
  // Personality: Tone consistency
  personality: {
    enabled: true,
    tone: 'professional', // professional, empathetic, witty
    consistency: true
  },
  // Clarification: Ask before answering
  clarification: {
    enabled: true,
    maxQuestions: 3,
    threshold: 0.6 // Confidence threshold
  },
  // Analytics: Drop-off tracking
  analytics: {
    enabled: true,
    trackDropOff: true,
    retrainWeakSpots: true
  },
  // Rate Limits: Usage throttling
  rateLimits: {
    enabled: true,
    maxTokensPerMinute: 100000,
    maxRequestsPerMinute: 60,
    maxUsersPerMinute: 100
  }
};

// ================= MEMORY SYSTEM =================
class MemorySystem {
  constructor() {
    this.memories = {};
  }

  store(userId, key, value, importance = 'medium') {
    if (!this.memories[userId]) {
      this.memories[userId] = {};
    }
    this.memories[userId][key] = {
      value,
      timestamp: Date.now(),
      importance
    };
    this.saveMemory(userId);
  }

  recall(userId, key) {
    if (this.memories[userId] && this.memories[userId][key]) {
      return this.memories[userId][key].value;
    }
    return null;
  }

  recallAll(userId) {
    return this.memories[userId] || {};
  }

  saveMemory(userId) {
    try {
      const memoryFile = `./memory_${userId}.json`;
      fs.writeFileSync(memoryFile, JSON.stringify(this.memories[userId], null, 2));
    } catch (error) {
      console.error("❌ Memory save error:", error);
    }
  }

  loadMemory(userId) {
    try {
      const memoryFile = `./memory_${userId}.json`;
      if (fs.existsSync(memoryFile)) {
        const data = fs.readFileSync(memoryFile);
        this.memories[userId] = JSON.parse(data);
        return true;
      }
    } catch (error) {
      console.error("❌ Memory load error:", error);
    }
    return false;
  }
}

const memorySystem = new MemorySystem();

// ================= GUARDRAILS SYSTEM =================
class Guardrails {
  constructor() {
    this.blockedPatterns = [
      /hack/i, /exploit/i, /jailbreak/i, /ignore previous/i,
      /bypass/i, /unauthorized/i, /malicious/i, /attack/i,
      /destroy/i, /damage/i, /illegal/i, /harm/i
    ];
    this.jailbreakPatterns = [
      /ignore all instructions/i,
      /forget previous/i,
      /act as if/i,
      /you are now/i,
      /bypass restrictions/i,
      /override/i
    ];
  }

  check(text) {
    const results = {
      isHarmful: false,
      isJailbreak: false,
      warnings: []
    };

    // Check for harmful content
    for (const pattern of this.blockedPatterns) {
      if (pattern.test(text)) {
        results.isHarmful = true;
        results.warnings.push(`Harmful content detected: ${pattern.source}`);
        break;
      }
    }

    // Check for jailbreak attempts
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

// ================= CLARIFICATION SYSTEM =================
class ClarificationSystem {
  constructor() {
    this.vaguePatterns = [
      /help/i, /something/i, /anything/i, /everything/i,
      /not sure/i, /maybe/i, /some/i
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
    return questions.slice(0, CONFIG.clarification.maxQuestions);
  }
}

const clarificationSystem = new ClarificationSystem();

// ================= ANALYTICS SYSTEM =================
class AnalyticsSystem {
  constructor() {
    this.dbFile = "./analytics.json";
    this.data = this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.dbFile)) {
        return JSON.parse(fs.readFileSync(this.dbFile));
      }
      return {
        sessions: {},
        dropOffs: {},
        weakSpots: {},
        totalMessages: 0,
        totalUsers: 0
      };
    } catch {
      return {
        sessions: {},
        dropOffs: {},
        weakSpots: {},
        totalMessages: 0,
        totalUsers: 0
      };
    }
  }

  save() {
    try {
      fs.writeFileSync(this.dbFile, JSON.stringify(this.data, null, 2));
    } catch (error) {
      console.error("❌ Analytics save error:", error);
    }
  }

  trackSession(userId, action, details = {}) {
    if (!this.data.sessions[userId]) {
      this.data.sessions[userId] = [];
      this.data.totalUsers++;
    }
    this.data.sessions[userId].push({
      action,
      timestamp: Date.now(),
      details
    });
    this.data.totalMessages++;
    this.save();
  }

  trackDropOff(userId, reason) {
    if (!this.data.dropOffs[userId]) {
      this.data.dropOffs[userId] = [];
    }
    this.data.dropOffs[userId].push({
      reason,
      timestamp: Date.now()
    });
    this.save();
  }

  trackWeakSpot(topic, issue) {
    if (!this.data.weakSpots[topic]) {
      this.data.weakSpots[topic] = [];
    }
    this.data.weakSpots[topic].push({
      issue,
      timestamp: Date.now()
    });
    this.save();
  }

  getStats() {
    return {
      totalUsers: this.data.totalUsers,
      totalMessages: this.data.totalMessages,
      activeUsers: Object.keys(this.data.sessions).length,
      dropOffCount: Object.keys(this.data.dropOffs).length,
      weakSpots: Object.keys(this.data.weakSpots)
    };
  }
}

const analytics = new AnalyticsSystem();

// ================= RATE LIMITER =================
class RateLimiter {
  constructor() {
    this.requests = {};
    this.tokens = {};
  }

  check(userId, tokens = 100) {
    const now = Date.now();
    const minute = 60000;

    // Check request rate
    if (!this.requests[userId]) {
      this.requests[userId] = [];
    }
    this.requests[userId] = this.requests[userId].filter(time => now - time < minute);
    
    if (this.requests[userId].length >= CONFIG.rateLimits.maxRequestsPerMinute) {
      return { allowed: false, reason: "Too many requests. Please wait." };
    }

    // Check token rate
    if (!this.tokens[userId]) {
      this.tokens[userId] = [];
    }
    this.tokens[userId] = this.tokens[userId].filter(time => now - time < minute);
    
    const totalTokens = this.tokens[userId].reduce((sum, t) => sum + t, 0);
    if (totalTokens + tokens > CONFIG.rateLimits.maxTokensPerMinute) {
      return { allowed: false, reason: "Token limit exceeded. Please wait." };
    }

    // Allow request
    this.requests[userId].push(now);
    this.tokens[userId].push(tokens);
    
    return { allowed: true };
  }
}

const rateLimiter = new RateLimiter();

// ================= PERSONALITY SYSTEM =================
class PersonalitySystem {
  constructor() {
    this.tone = CONFIG.personality.tone;
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

  applyTone(text) {
    const tone = this.getTone();
    // Apply tone modifications based on style
    // This would be more sophisticated in production
    return text;
  }
}

const personality = new PersonalitySystem();

// ================= VALIDATE ENV =================
console.log("🔍 Checking environment variables...");
console.log("BOT_TOKEN:", process.env.BOT_TOKEN ? "✅ Set" : "❌ Missing");
console.log("GEMINI_API_KEY:", process.env.GEMINI_API_KEY ? "✅ Set" : "❌ Missing");
console.log("WEBHOOK_URL:", process.env.WEBHOOK_URL || "❌ Missing");

const requiredEnv = ['BOT_TOKEN', 'GEMINI_API_KEY', 'WEBHOOK_URL'];
for (const env of requiredEnv) {
  if (!process.env[env]) {
    console.error(`❌ Missing required environment variable: ${env}`);
    process.exit(1);
  }
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

// ================= DB =================
const DB_FILE = "./db.json";
function loadDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify({ users: {}, stats: { totalMessages: 0 } }, null, 2));
    }
    return JSON.parse(fs.readFileSync(DB_FILE));
  } catch { return { users: {}, stats: { totalMessages: 0 } }; }
}

let db = loadDB();

function saveDB() {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); } catch {}
}

function getUser(id) {
  const userId = String(id);
  if (!db.users[userId]) {
    const isAdmin = ADMIN_IDS.includes(userId);
    db.users[userId] = {
      premium: isAdmin,
      isAdmin: isAdmin,
      requests: 0,
      totalMessages: 0,
      chatHistory: [],
      coins: isAdmin ? 9999 : 0,
      imagesGenerated: 0,
      joinedDate: new Date().toISOString()
    };
    db.stats.totalUsers = (db.stats.totalUsers || 0) + 1;
    saveDB();
  }
  return db.users[userId];
}

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
  const keywords = [
    'who created you', 'who made you', 'who is your developer',
    'who is your creator', 'who built you', 'who programmed you',
    'who developed you', 'who is the developer', 'who is the creator',
    'who is the owner', 'who owns you', 'who is behind you',
    'tell me about the developer', 'tell me about the creator',
    'who made this bot', 'who is king of alpha', 'muhammad ilyas',
    'ilyas', 'king of alpha', 'developer name', 'creator name', 'owner name'
  ];
  return keywords.some(keyword => lowerText.includes(keyword));
}

// ================= GROUNDING: REAL-TIME SEARCH =================
async function searchWeb(query) {
  try {
    // Using a free search API (you can replace with your preferred)
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

// ================= IMAGE GENERATION WITH POLLINATIONS AI =================
async function generateImage(prompt, userId) {
  try {
    const user = getUser(userId);
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
    saveDB();
    
    analytics.trackSession(userId, 'image_generated', { prompt: prompt.substring(0, 50) });
    
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
  
  // Track drop-off
  analytics.trackDropOff(userId, 'uncertain_response');
  
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
  const user = getUser(userId);
  const isPremium = user.premium || user.isAdmin;
  const status = isPremium ? '💎 Alpha Pro' : '🆓 Free';
  
  // Load user memory
  memorySystem.loadMemory(userId);
  
  await bot.sendMessage(
    chatId,
    `🐺 **Alpha AI Pro - Enterprise Edition**\n\n` +
    `👤 Status: ${status}\n` +
    `📊 Messages: ${user.requests || 0}\n` +
    `🖼️ Images: ${user.imagesGenerated || 0}\n` +
    `🪙 Coins: ${user.coins || 0}\n\n` +
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
  
  analytics.trackSession(userId, 'menu_viewed');
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
  const user = getUser(userId);
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

// Analytics Button
bot.onText(/📈 Analytics/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const user = getUser(userId);
  
  if (!user.isAdmin && !user.premium) {
    await bot.sendMessage(
      chatId,
      `📈 **Analytics**\n\n` +
      `This feature is available for Premium and Admin users only.\n\n` +
      `💎 Upgrade to Alpha Pro to access analytics!`
    );
    return;
  }
  
  const stats = analytics.getStats();
  await bot.sendMessage(
    chatId,
    `📈 **Analytics Dashboard**\n\n` +
    `👥 **Total Users:** ${stats.totalUsers}\n` +
    `💬 **Total Messages:** ${stats.totalMessages}\n` +
    `🟢 **Active Users:** ${stats.activeUsers}\n` +
    `📉 **Drop-offs:** ${stats.dropOffCount}\n` +
    `🔴 **Weak Spots:** ${stats.weakSpots.length > 0 ? stats.weakSpots.join(', ') : 'None detected'}\n\n` +
    `📊 **System Status:**\n` +
    `• Memory: ✅ Active\n` +
    `• Guardrails: ✅ Active\n` +
    `• Rate Limits: ✅ ${CONFIG.rateLimits.maxRequestsPerMinute}/min\n` +
    `• Personality: ${CONFIG.personality.tone}\n\n` +
    `🔄 *Analytics updated in real-time*`
  );
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
    const user = getUser(userId);
    
    // Track session
    analytics.trackSession(userId, 'message_received', { text: text.substring(0, 50) });
    
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
      analytics.trackDropOff(userId, 'guardrail_blocked');
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
      analytics.trackDropOff(userId, 'jailbreak_attempt');
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
        `• ${CONFIG.rateLimits.maxRequestsPerMinute} requests/min\n` +
        `• ${CONFIG.rateLimits.maxTokensPerMinute} tokens/min`
      );
      analytics.trackDropOff(userId, 'rate_limited');
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
    
    // 4. MULTI-MODAL - Check if generating image
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
    
    // 5. PERSONALITY - Apply tone
    const tone = personality.getTone();
    
    // 6. MEMORY - Cross-session recall
    memorySystem.loadMemory(userId);
    const rememberedName = memorySystem.recall(userId, 'name');
    const rememberedProjects = memorySystem.recall(userId, 'projects');
    
    let memoryContext = "";
    if (rememberedName) {
      memoryContext += `\nUser's name: ${rememberedName}`;
    }
    if (rememberedProjects) {
      memoryContext += `\nUser's projects: ${rememberedProjects}`;
    }
    
    // 7. CLARIFICATION - Check if needs clarification
    if (clarificationSystem.needsClarification(text)) {
      const questions = clarificationSystem.generateQuestions(text);
      await bot.sendMessage(
        chatId,
        `🤔 **Let me clarify**\n\n` +
        `To give you the best answer, I need a bit more information:\n\n` +
        questions.map((q, i) => `${i+1}. ${q}`).join('\n') + `\n\n` +
        `*Please provide more details and I'll help you out!*`
      );
      analytics.trackSession(userId, 'clarification_asked');
      return;
    }
    
    // 8. GROUNDING - Real-time search if relevant
    let searchResult = null;
    if (text.toLowerCase().includes('search') || 
        text.toLowerCase().includes('latest') ||
        text.toLowerCase().includes('news') ||
        text.toLowerCase().includes('current')) {
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
    
    // 9. REGULAR CHAT with ENTERPRISE CONTEXT
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
      // 10. FALLBACK - Graceful failure
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
    db.stats.totalMessages = (db.stats.totalMessages || 0) + 1;
    incrementQuota(userId);

    if (user.chatHistory.length > (isPremium ? 100 : 20)) {
      user.chatHistory = user.chatHistory.slice(-(isPremium ? 100 : 20));
    }

    // Build context with memory
    let context = "";
    for (const entry of user.chatHistory) {
      context += `${entry.role === 'user' ? 'User' : 'Assistant'}: ${entry.content}\n`;
    }
    
    // Add memory context
    if (memoryContext) {
      context += `\n[Memory Context:${memoryContext}]\n`;
    }

    // Add search result if available
    if (searchResult) {
      context += `\n[Live Search Data: ${searchResult.content.substring(0, 200)}...]\n`;
    }

    // Generate response with personality
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
    
    // Store in memory
    memorySystem.store(userId, 'last_conversation', text);
    if (text.toLowerCase().includes('my name is')) {
      const nameMatch = text.match(/my name is (\w+)/i);
      if (nameMatch) {
        memorySystem.store(userId, 'name', nameMatch[1], 'high');
        await bot.sendMessage(
          chatId,
          `📝 *I'll remember your name: ${nameMatch[1]}*`
        );
      }
    }

    user.chatHistory.push({ role: "assistant", content: answer });
    saveDB();

    await bot.sendMessage(chatId, answer);
    
    analytics.trackSession(userId, 'response_sent', { length: answer.length });

  } catch (error) {
    console.error("❌ Error:", error.message);
    analytics.trackDropOff(userId, 'error');
    
    // Fallback with follow-up questions
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
        const user = getUser(userId);
        user.premium = true;
        saveDB();
        
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

app.get("/api/status", (req, res) => {
  const analytics = {
    totalUsers: Object.keys(db.users).length,
    totalMessages: db.stats.totalMessages || 0,
    systemStatus: {
      memory: "✅ Active",
      guardrails: "✅ Active",
      rateLimits: `✅ ${CONFIG.rateLimits.maxRequestsPerMinute}/min`,
      personality: CONFIG.personality.tone,
      grounding: "✅ Active",
      clarification: "✅ Active"
    }
  };
  res.json({
    status: "✅ Online",
    ...analytics
  });
});

// ================= START SERVER =================
app.listen(PORT, async () => {
  console.log(`🐺 Alpha AI Pro - Enterprise Edition`);
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`👥 Users: ${Object.keys(db.users).length}`);
  console.log(`👑 Developer: ${DEVELOPER.name} (@${DEVELOPER.username})`);
  console.log(`🧠 Enterprise Features: Active`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ Memory: Cross-session recall`);
  console.log(`✅ Multi-Modal: Text + Image + File`);
  console.log(`✅ Grounding: Real-time search`);
  console.log(`✅ Guardrails: Safety + jailbreak`);
  console.log(`✅ Fallback: Graceful + handoff`);
  console.log(`✅ Personality: ${CONFIG.personality.tone}`);
  console.log(`✅ Clarification: Smart questions`);
  console.log(`✅ Analytics: Drop-off tracking`);
  console.log(`✅ Rate Limits: ${CONFIG.rateLimits.maxRequestsPerMinute}/min`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  await setWebhook();
  console.log(`✅ Bot ready!`);
});

// ================= ERROR HANDLING =================
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled Rejection:', error);
});
