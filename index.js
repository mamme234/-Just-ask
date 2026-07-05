import express from "express";
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import fs from "fs";
import Stripe from "stripe";
import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
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

// ================= DEVELOPER KEYWORDS =================
const DEVELOPER_KEYWORDS = [
  'who created you', 'who made you', 'who is your developer',
  'who is your creator', 'who built you', 'who programmed you',
  'who developed you', 'who is the developer', 'who is the creator',
  'who is the owner', 'who owns you', 'who is behind you',
  'tell me about the developer', 'tell me about the creator',
  'who made this bot', 'who is king of alpha', 'muhammad ilyas',
  'ilyas', 'king of alpha', 'developer name', 'creator name', 'owner name'
];

// ================= VALIDATE ENV =================
console.log("🔍 Checking environment variables...");
console.log("BOT_TOKEN:", process.env.BOT_TOKEN ? "✅ Set" : "❌ Missing");
console.log("GEMINI_API_KEY:", process.env.GEMINI_API_KEY ? "✅ Set" : "❌ Missing");
console.log("XAI_API_KEY:", process.env.XAI_API_KEY ? "✅ Set" : "❌ Missing");
console.log("WEBHOOK_URL:", process.env.WEBHOOK_URL || "❌ Missing");

const requiredEnv = ['BOT_TOKEN', 'GEMINI_API_KEY', 'XAI_API_KEY', 'WEBHOOK_URL'];
for (const env of requiredEnv) {
  if (!process.env[env]) {
    console.error(`❌ Missing required environment variable: ${env}`);
    process.exit(1);
  }
}

// ================= INITIALIZE SERVICES =================
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: false });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ================= AI ENGINE (Gemini for Chat) =================
const aiEngine = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const AI_MODELS = ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-3.5-flash"];
let activeModel = null;
let aiProcessor = null;
let aiReady = false;

// ================= XAI/Grok for Image Generation =================
const xaiClient = new OpenAI({
    apiKey: process.env.XAI_API_KEY,
    baseURL: 'https://api.x.ai/v1',
});

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
  return DEVELOPER_KEYWORDS.some(keyword => lowerText.includes(keyword));
}

// ================= IMAGE GENERATION WITH GROK =================
async function generateImage(prompt, userId) {
  try {
    const user = getUser(userId);
    const isPremium = user.premium || user.isAdmin;
    
    if (!isPremium && user.imagesGenerated >= 2) {
      return { error: "⚠️ Free limit reached. Upgrade to Alpha Pro for unlimited images!" };
    }
    
    console.log(`🖼️ Generating image with Grok: "${prompt.substring(0, 50)}..."`);
    
    const response = await xaiClient.images.generate({
      model: "grok-imagine-image-quality",
      prompt: prompt,
      n: 1,
      response_format: "b64_json",
    });
    
    const imageBuffer = Buffer.from(response.data[0].b64_json, 'base64');
    
    user.imagesGenerated = (user.imagesGenerated || 0) + 1;
    saveDB();
    
    return { 
      buffer: imageBuffer, 
      description: `✨ "${prompt}"`,
      revised: response.data[0].revised_prompt || null
    };
    
  } catch (error) {
    console.error("❌ Grok image error:", error.message);
    
    // Fallback to Gemini canvas image
    try {
      console.log("🔄 Falling back to Gemini canvas for image...");
      return await generateImageGemini(prompt, userId);
    } catch (fallbackError) {
      return { error: "⚠️ Failed to generate image. Please try again." };
    }
  }
}

// ================= FALLBACK: Gemini Canvas Image =================
async function generateImageGemini(prompt, userId) {
  try {
    const user = getUser(userId);
    const isPremium = user.premium || user.isAdmin;
    
    if (!isPremium && user.imagesGenerated >= 2) {
      return { error: "⚠️ Free limit reached. Upgrade to Alpha Pro for unlimited images!" };
    }
    
    const canvas = createCanvas(1024, 768);
    const ctx = canvas.getContext('2d');
    
    // Background
    const gradient = ctx.createLinearGradient(0, 0, 1024, 768);
    gradient.addColorStop(0, '#0a0a2e');
    gradient.addColorStop(0.5, '#1a1a4e');
    gradient.addColorStop(1, '#2d1b69');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1024, 768);
    
    // Decorative circles
    for (let i = 0; i < 50; i++) {
      ctx.beginPath();
      ctx.arc(Math.random() * 1024, Math.random() * 768, Math.random() * 20 + 5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${Math.random() * 0.05})`;
      ctx.fill();
    }
    
    // Border
    ctx.strokeStyle = '#667eea';
    ctx.lineWidth = 3;
    ctx.strokeRect(20, 20, 984, 728);
    
    // Logo
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 80px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('🐺', 512, 140);
    
    // Title
    ctx.fillStyle = '#667eea';
    ctx.font = 'bold 44px Arial';
    ctx.fillText('Alpha AI Pro', 512, 220);
    
    ctx.fillStyle = '#aaa';
    ctx.font = '22px Arial';
    ctx.fillText('AI Generated Image', 512, 270);
    
    // Divider
    ctx.strokeStyle = 'rgba(102, 126, 234, 0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(100, 300);
    ctx.lineTo(924, 300);
    ctx.stroke();
    
    // Prompt
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 22px Arial';
    ctx.fillText('📝 Prompt:', 50, 350);
    
    ctx.fillStyle = '#ddd';
    ctx.font = '18px Arial';
    const words = prompt.split(' ');
    let lines = [];
    let currentLine = '';
    for (const word of words) {
      if ((currentLine + word).length > 50) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine += (currentLine ? ' ' : '') + word;
      }
    }
    if (currentLine) lines.push(currentLine);
    
    let y = 390;
    for (const line of lines.slice(0, 8)) {
      ctx.fillStyle = '#ddd';
      ctx.font = '18px Arial';
      ctx.fillText('  ' + line, 50, y);
      y += 35;
    }
    
    // Footer
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.font = '12px Arial';
    ctx.fillText(`Alpha AI Pro • By ${DEVELOPER.name}`, 512, 700);
    
    if (isPremium) {
      ctx.fillStyle = '#FFD700';
      ctx.font = 'bold 18px Arial';
      ctx.fillText('💎 PREMIUM', 850, 100);
    }
    
    const buffer = canvas.toBuffer('image/png');
    user.imagesGenerated = (user.imagesGenerated || 0) + 1;
    saveDB();
    
    return { buffer, description: `✨ "${prompt}"` };
  } catch (error) {
    return { error: "⚠️ Failed to generate image. Please try again." };
  }
}

// ================= KEYBOARD BUTTONS =================
function getMainKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '💬 Chat' }, { text: '🖼️ Image' }, { text: '📸 Photo' }],
        [{ text: '🎬 Video' }, { text: '🎨 Design' }, { text: '👑 Developer' }],
        [{ text: '📊 Status' }, { text: '💎 Pro' }, { text: '🔄 Reset' }],
        [{ text: '❓ Help' }]
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
  
  await bot.sendMessage(
    chatId,
    `🐺 **Alpha AI Pro**\n\n` +
    `👤 Status: ${status}\n` +
    `📊 Messages: ${user.requests || 0}\n` +
    `🖼️ Images: ${user.imagesGenerated || 0}\n` +
    `🪙 Coins: ${user.coins || 0}\n\n` +
    `━━━━━━━━━━━━━━━━━━━\n` +
    `💬 *Send any message to chat with AI*\n` +
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
    `💡 Try asking:\n` +
    `• "Explain quantum computing"\n` +
    `• "Write a poem about AI"\n` +
    `• "Help me with my code"\n` +
    `• "What's the weather like?"\n\n` +
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
  const user = getUser(userId);
  const isPremium = user.premium || user.isAdmin;
  const days = Math.floor((Date.now() - new Date(user.joinedDate).getTime()) / (1000 * 60 * 60 * 24));
  
  await bot.sendMessage(
    chatId,
    `📊 **Your Profile**\n\n` +
    `👤 User ID: \`${userId}\`\n` +
    `💎 Plan: ${isPremium ? 'Alpha Pro' : 'Free'}\n` +
    `📊 Messages: ${user.requests || 0}\n` +
    `🖼️ Images: ${user.imagesGenerated || 0}\n` +
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
  const user = getUser(userId);
  
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
  const user = getUser(userId);
  user.chatHistory = [];
  saveDB();
  
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
    `**Free Limits:**\n` +
    `• 5 messages\n` +
    `• 2 images\n\n` +
    `**Alpha Pro:**\n` +
    `• Unlimited everything! 🚀`,
    { parse_mode: "Markdown" }
  );
});

// New Chat Button
bot.onText(/💬 New Chat/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const user = getUser(userId);
  user.chatHistory = [];
  saveDB();
  
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
  
  await bot.sendPhoto(chatId, result.buffer, {
    caption: `🎨 **Random Art**\n\n${result.description}\n\n🪙 Coins: ${getUser(userId).coins || 0}`
  });
});

// ================= MESSAGE HANDLER =================
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const text = msg.text;

  if (!text || text.startsWith("/") || text.startsWith("🔙") || text.startsWith("💬") || 
      text.startsWith("🖼️") || text.startsWith("📸") || text.startsWith("🎬") || 
      text.startsWith("🎨") || text.startsWith("👑") || text.startsWith("📊") || 
      text.startsWith("💎") || text.startsWith("🔄") || text.startsWith("❓") ||
      text.startsWith("🌅") || text.startsWith("🎨 Random")) {
    return;
  }

  try {
    const user = getUser(userId);
    
    // Check for developer question
    if (isDeveloperQuestion(text)) {
      await bot.sendMessage(
        chatId,
        getDeveloperInfo(),
        { parse_mode: "Markdown", disable_web_page_preview: true }
      );
      return;
    }
    
    if (!aiReady) {
      await initializeAI();
      if (!aiReady) {
        throw new Error("AI Engine not ready");
      }
    }

    const isPremium = user.premium || user.isAdmin;

    // Check if generating image
    if (text.toLowerCase().includes('image') || 
        text.toLowerCase().includes('picture') ||
        text.toLowerCase().includes('draw') ||
        text.toLowerCase().includes('create') ||
        text.toLowerCase().includes('generate')) {
      
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

    // Regular chat - check quota
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

    // Check daily quota for AI
    if (!checkQuota(userId)) {
      await bot.sendMessage(chatId, getFallbackResponse(), { parse_mode: "Markdown" });
      return;
    }

    await bot.sendChatAction(chatId, "typing");

    user.chatHistory = user.chatHistory || [];
    user.chatHistory.push({ role: "user", content: text });
    user.requests = (user.requests || 0) + 1;
    user.totalMessages = (user.totalMessages || 0) + 1;
    db.stats.totalMessages = (db.stats.totalMessages || 0) + 1;
    incrementQuota(userId);

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
          text: `You are Alpha AI Pro, a professional AI assistant created by Muhammad Ilyas (@KING_OF_ALPHA). 
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
    saveDB();

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
        const user = getUser(userId);
        user.premium = true;
        saveDB();
        
        await bot.sendMessage(
          userId,
          `💎 **Alpha AI Pro Unlocked!**\n\n` +
          `🎉 You now have unlimited access to all features!\n\n` +
          `• Unlimited AI Chat\n` +
          `• Unlimited Images\n` +
          `• Unlimited Photo Editing\n` +
          `• Unlimited Video Processing\n` +
          `• Advanced Design Tools\n\n` +
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
        <div class="emoji
