import express from "express";
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import fs from "fs";
import Stripe from "stripe";
import { GoogleGenerativeAI } from "@google/generative-ai";
import path from "path";
import { fileURLToPath } from 'url';
import axios from "axios";
import sharp from "sharp";
import { createCanvas, loadImage } from 'canvas';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// ================= OWNER CONFIGURATION =================
const OWNER = {
  name: "Muhammad Ilyas",
  username: "@KING_OF_ALPHA",
  telegram: "https://t.me/KING_OF_ALPHA",
  github: "https://github.com/mamme234",
  email: "ghazimuhammadilyas@gmail.com",
  bio: "👑 King of Alpha | Full-Stack Developer | AI Enthusiast",
  skills: ["JavaScript", "Python", "AI/ML", "Web Dev", "Bot Dev", "Blockchain", "Cloud"],
  achievements: ["🏆 50+ Bots", "🚀 10k+ Users", "💡 AI Innovator", "👑 Alpha Developer"]
};

// ================= ADMIN CONFIGURATION =================
const ADMIN_IDS = [
  "123456789", // Replace with your Telegram user ID
];

// ================= EMOJI & STYLE =================
const E = {
  pro: "⚡",
  chat: "💬",
  ai: "🧠",
  sparkle: "✨",
  fire: "🔥",
  rocket: "🚀",
  brain: "🧠",
  magic: "🎯",
  crown: "👑",
  diamond: "💎",
  lightning: "⚡",
  robot: "🤖",
  heart: "❤️",
  star: "⭐",
  code: "💻",
  link: "🔗",
  mail: "📧",
  trophy: "🏆",
  alpha: "🐺",
  premium: "💎",
  free: "🆓",
  image: "🖼️",
  video: "🎬",
  edit: "✏️",
  photo: "📸",
  palette: "🎨",
  layers: "📐",
  filter: "🔮"
};

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

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ================= MODEL SELECTION =================
const TEST_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash", 
  "gemini-3.5-flash",
  "gemini-flash-latest"
];

let workingModel = null;
let model = null;
let modelInitialized = false;

async function findWorkingModel() {
  console.log("🔍 Searching for working model...");
  
  for (const modelName of TEST_MODELS) {
    try {
      console.log(`🔄 Testing: ${modelName}`);
      
      const testModel = genAI.getGenerativeModel({ 
        model: modelName,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 100,
        }
      });
      
      const result = await testModel.generateContent({
        contents: [{ role: "user", parts: [{ text: "Say hello" }] }]
      });
      
      const response = result.response.text();
      console.log(`✅ ${modelName} works!`);
      
      workingModel = modelName;
      model = testModel;
      modelInitialized = true;
      return true;
      
    } catch (error) {
      console.error(`❌ ${modelName} failed:`, error.message);
    }
  }
  
  console.error("❌ No working model found!");
  return false;
}

await findWorkingModel();

// ================= DB =================
const DB_FILE = "./db.json";

function loadDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify({ users: {}, stats: { totalMessages: 0 } }, null, 2));
      return { users: {}, stats: { totalMessages: 0 } };
    }
    return JSON.parse(fs.readFileSync(DB_FILE));
  } catch (error) {
    console.error("❌ DB Error:", error);
    return { users: {}, stats: { totalMessages: 0 } };
  }
}

let db = loadDB();

function saveDB() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (error) {
    console.error("❌ Save DB Error:", error);
  }
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
      adsWatched: 0,
      coins: isAdmin ? 9999 : 0,
      joinedDate: new Date().toISOString(),
      imagesGenerated: 0,
      videosProcessed: 0
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
    console.log(`🔄 Setting webhook to: ${webhookUrl}`);
    
    await bot.setWebHook('', { drop_pending_updates: true });
    const result = await bot.setWebHook(webhookUrl, {
      allowed_updates: ['message', 'callback_query']
    });
    
    console.log(result ? "✅ Webhook set!" : "❌ Webhook failed!");
  } catch (error) {
    console.error("❌ Webhook error:", error.message);
  }
}

app.post(WEBHOOK_PATH, async (req, res) => {
  try {
    await bot.processUpdate(req.body);
    res.sendStatus(200);
  } catch (error) {
    console.error("❌ Webhook processing error:", error);
    res.sendStatus(500);
  }
});

// ================= IMAGE GENERATION FUNCTIONS =================
async function generateImage(prompt, userId) {
  try {
    const user = getUser(userId);
    const isPremium = user.premium || user.isAdmin;
    
    if (!isPremium && user.imagesGenerated >= 2) {
      return { error: "Free limit reached. Upgrade to premium for unlimited image generation!" };
    }
    
    // Using Gemini to generate image description and then create placeholder
    // For production, you'd use actual image generation API like DALL-E, Stable Diffusion, etc.
    
    const imagePrompt = await model.generateContent({
      contents: [{
        role: "user",
        parts: [{ text: `Create a detailed image description based on: ${prompt}` }]
      }],
      generationConfig: { maxOutputTokens: 200 }
    });
    
    const description = imagePrompt.response.text();
    
    // Create a placeholder image with text
    const canvas = createCanvas(800, 600);
    const ctx = canvas.getContext('2d');
    
    // Background gradient
    const gradient = ctx.createLinearGradient(0, 0, 800, 600);
    gradient.addColorStop(0, '#1a1a2e');
    gradient.addColorStop(0.5, '#16213e');
    gradient.addColorStop(1, '#0f3460');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 800, 600);
    
    // Draw border
    ctx.strokeStyle = '#667eea';
    ctx.lineWidth = 3;
    ctx.strokeRect(10, 10, 780, 580);
    
    // Title
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('🖼️ AI Generated Image', 400, 60);
    
    // Prompt
    ctx.fillStyle = '#aaa';
    ctx.font = '18px Arial';
    ctx.fillText('Prompt: ' + prompt.substring(0, 40) + (prompt.length > 40 ? '...' : ''), 400, 100);
    
    // Description
    ctx.fillStyle = '#888';
    ctx.font = '14px Arial';
    const lines = description.match(/.{1,60}/g) || [];
    let y = 160;
    for (const line of lines.slice(0, 12)) {
      ctx.fillText(line, 400, y);
      y += 25;
    }
    
    // Footer
    ctx.fillStyle = '#666';
    ctx.font = '12px Arial';
    ctx.fillText(`Generated by Alpha AI Bot | ${new Date().toLocaleDateString()}`, 400, 560);
    
    const buffer = canvas.toBuffer('image/png');
    
    user.imagesGenerated = (user.imagesGenerated || 0) + 1;
    saveDB();
    
    return { buffer, description };
  } catch (error) {
    console.error("❌ Image generation error:", error);
    return { error: "Failed to generate image. Please try again." };
  }
}

// ================= PHOTO EDITING FUNCTIONS =================
async function editPhoto(photoBuffer, action, params = {}) {
  try {
    let result;
    
    switch(action) {
      case 'brightness':
        result = await sharp(photoBuffer)
          .modulate({ brightness: params.brightness || 1.2 })
          .toBuffer();
        break;
        
      case 'contrast':
        result = await sharp(photoBuffer)
          .modulate({ contrast: params.contrast || 1.3 })
          .toBuffer();
        break;
        
      case 'blur':
        result = await sharp(photoBuffer)
          .blur(params.blur || 5)
          .toBuffer();
        break;
        
      case 'resize':
        result = await sharp(photoBuffer)
          .resize(params.width || 800, params.height || 600, { fit: 'inside' })
          .toBuffer();
        break;
        
      case 'grayscale':
        result = await sharp(photoBuffer)
          .grayscale()
          .toBuffer();
        break;
        
      case 'sepia':
        result = await sharp(photoBuffer)
          .modulate({ sepia: params.sepia || 0.8 })
          .toBuffer();
        break;
        
      case 'rotate':
        result = await sharp(photoBuffer)
          .rotate(params.rotate || 90)
          .toBuffer();
        break;
        
      case 'flip':
        result = await sharp(photoBuffer)
          .flip()
          .toBuffer();
        break;
        
      case 'flop':
        result = await sharp(photoBuffer)
          .flop()
          .toBuffer();
        break;
        
      case 'vintage':
        // Apply vintage filter
        result = await sharp(photoBuffer)
          .modulate({
            brightness: 0.8,
            contrast: 1.1,
            saturation: 0.7
          })
          .toBuffer();
        break;
        
      case 'dramatic':
        result = await sharp(photoBuffer)
          .modulate({
            brightness: 0.7,
            contrast: 1.5,
            saturation: 1.3
          })
          .toBuffer();
        break;
        
      case 'vibrant':
        result = await sharp(photoBuffer)
          .modulate({
            saturation: 1.5,
            contrast: 1.1
          })
          .toBuffer();
        break;
        
      default:
        result = photoBuffer;
    }
    
    return result;
  } catch (error) {
    console.error("❌ Photo editing error:", error);
    throw error;
  }
}

// ================= COMMANDS =================
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const user = getUser(userId);
  
  const isPremium = user.premium || user.isAdmin;
  const status = isPremium ? `${E.premium} Premium` : `${E.free} Free`;
  const adminBadge = user.isAdmin ? ` ${E.crown} Admin` : '';
  
  await bot.sendMessage(
    chatId,
    `${E.robot} **ALPHA AI PRO - CHATGPT STYLE** ${E.robot}\n\n` +
    `👤 **Status:** ${status}${adminBadge}\n` +
    `📊 **Messages:** ${user.requests || 0}/∞\n` +
    `${E.coin} **Coins:** ${user.coins || 0}\n` +
    `${E.image} **Images:** ${user.imagesGenerated || 0}\n\n` +
    `**🎯 Commands:**\n` +
    `${E.chat} /chat - Start AI chat\n` +
    `${E.image} /image - Generate image\n` +
    `${E.photo} /photo - Edit photo\n` +
    `${E.video} /video - Process video\n` +
    `${E.palette} /design - Design tools\n` +
    `${E.diamond} /buy - Upgrade to Premium\n` +
    `${E.crown} /owner - About Owner\n` +
    `${E.star} /help - All Commands\n\n` +
    `${E.fire} *Send any message to chat with AI!* ${E.fire}`,
    { parse_mode: "Markdown" }
  );
});

// ================= CHAT COMMAND =================
bot.onText(/\/chat/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(
    chatId,
    `${E.chat} **AI CHAT MODE** ${E.chat}\n\n` +
    `Send me any message and I'll respond like ChatGPT!\n\n` +
    `💡 Try:\n` +
    `• "Explain quantum computing"\n` +
    `• "Write a poem about AI"\n` +
    `• "What's the weather like?"\n` +
    `• "Help me with my code"\n\n` +
    `${E.sparkle} *Type your message now!* ${E.sparkle}`
  );
});

// ================= IMAGE COMMAND =================
bot.onText(/\/image/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const user = getUser(userId);
  
  const isPremium = user.premium || user.isAdmin;
  const maxFree = 2;
  
  if (!isPremium && user.imagesGenerated >= maxFree) {
    await bot.sendMessage(
      chatId,
      `${E.fire} **FREE LIMIT REACHED** ${E.fire}\n\n` +
      `You've used ${user.imagesGenerated} free images.\n` +
      `${E.diamond} **Upgrade to Premium for unlimited image generation!**\n\n` +
      `Use /buy to upgrade.`,
      { parse_mode: "Markdown" }
    );
    return;
  }
  
  await bot.sendMessage(
    chatId,
    `${E.image} **IMAGE GENERATOR** ${E.image}\n\n` +
    `Describe the image you want to generate.\n\n` +
    `💡 Examples:\n` +
    `• "A futuristic city at sunset"\n` +
    `• "A cute cat with a crown"\n` +
    `• "Abstract art with vibrant colors"\n\n` +
    `${E.premium} ${isPremium ? 'Unlimited generations' : `${maxFree - user.imagesGenerated} free generations left`}\n\n` +
    `*Send your image description now!*`,
    { parse_mode: "Markdown" }
  );
});

// ================= PHOTO EDIT COMMAND =================
bot.onText(/\/photo/, async (msg) => {
  const chatId = msg.chat.id;
  
  await bot.sendMessage(
    chatId,
    `${E.photo} **PHOTO EDITING TOOLS** ${E.photo}\n\n` +
    `**Available Filters:**\n` +
    `📸 /brightness - Adjust brightness\n` +
    `🎨 /contrast - Adjust contrast\n` +
    `🔮 /blur - Apply blur effect\n` +
    `📐 /resize - Resize image\n` +
    `⚫ /grayscale - Convert to B&W\n` +
    `🟫 /sepia - Apply sepia tone\n` +
    `🔄 /rotate - Rotate image\n` +
    `🔄 /flip - Flip image\n` +
    `📻 /vintage - Vintage filter\n` +
    `🎬 /dramatic - Dramatic effect\n` +
    `🌈 /vibrant - Vibrant colors\n\n` +
    `Send a photo and tell me which filter to apply!`,
    { parse_mode: "Markdown" }
  );
});

// ================= VIDEO COMMAND =================
bot.onText(/\/video/, async (msg) => {
  const chatId = msg.chat.id;
  
  await bot.sendMessage(
    chatId,
    `${E.video} **VIDEO PROCESSING** ${E.video}\n\n` +
    `**Available Tools:**\n` +
    `🎬 /trim - Trim video\n` +
    `🔄 /convert - Convert format\n` +
    `📐 /resize-video - Resize video\n` +
    `⚡ /speed - Change speed\n` +
    `🎵 /add-audio - Add background music\n\n` +
    `Send me a video to process!`,
    { parse_mode: "Markdown" }
  );
});

// ================= DESIGN COMMAND =================
bot.onText(/\/design/, async (msg) => {
  const chatId = msg.chat.id;
  
  await bot.sendMessage(
    chatId,
    `${E.palette} **DESIGN TOOLS** ${E.palette}\n\n` +
    `**Available Designs:**\n` +
    `🎨 /poster - Create poster\n` +
    `📊 /infographic - Create infographic\n` +
    `🎯 /logo - Create logo\n` +
    `📄 /banner - Create banner\n` +
    `🖼️ /meme - Create meme\n\n` +
    `Tell me what design you need and describe it!`,
    { parse_mode: "Markdown" }
  );
});

// ================= HELP COMMAND =================
bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;
  
  await bot.sendMessage(
    chatId,
    `${E.star} **ALPHA AI PRO - COMPLETE GUIDE** ${E.star}\n\n` +
    `**🤖 AI Chat**\n` +
    `/chat - Start AI conversation\n` +
    `Just type any message to chat\n\n` +
    `**🖼️ Image Generation**\n` +
    `/image - Generate images\n` +
    `Describe what you want to create\n\n` +
    `**📸 Photo Editing**\n` +
    `/photo - Edit photos\n` +
    `/brightness - Adjust brightness\n` +
    `/contrast - Adjust contrast\n` +
    `/blur - Apply blur\n` +
    `/grayscale - Black & white\n` +
    `/sepia - Sepia tone\n` +
    `/rotate - Rotate image\n` +
    `/flip - Flip image\n` +
    `/vintage - Vintage filter\n` +
    `/dramatic - Dramatic effect\n` +
    `/vibrant - Vibrant colors\n\n` +
    `**🎬 Video Processing**\n` +
    `/video - Process videos\n` +
    `/trim - Trim video\n` +
    `/convert - Convert format\n` +
    `/speed - Change speed\n\n` +
    `**🎨 Design Tools**\n` +
    `/design - Design tools\n` +
    `/poster - Create poster\n` +
    `/logo - Create logo\n` +
    `/banner - Create banner\n` +
    `/meme - Create meme\n\n` +
    `**💎 Premium**\n` +
    `/buy - Upgrade for $5\n` +
    `• Unlimited everything\n` +
    `• Priority processing\n` +
    `• Advanced features\n\n` +
    `**👤 Account**\n` +
    `/status - Your stats\n` +
    `/reset - Reset chat\n` +
    `/owner - About owner\n\n` +
    `${E.fire} *Send any message to chat with AI!* ${E.fire}`,
    { parse_mode: "Markdown" }
  );
});

// ================= OWNER COMMAND =================
bot.onText(/\/owner/, async (msg) => {
  const chatId = msg.chat.id;
  
  await bot.sendMessage(
    chatId,
    `${E.alpha} **ABOUT THE OWNER** ${E.alpha}\n\n` +
    `👤 **Name:** Muhammad Ilyas\n` +
    `📝 **Username:** @KING_OF_ALPHA\n` +
    `📋 **Bio:** 👑 King of Alpha | Full-Stack Developer | AI Enthusiast\n\n` +
    `${E.code} **Skills:**\n` +
    `• JavaScript • Python • AI/ML\n` +
    `• Web Dev • Bot Dev • Blockchain • Cloud\n\n` +
    `${E.trophy} **Achievements:**\n` +
    `• 🏆 Built 50+ Bots\n` +
    `• 🚀 10k+ Active Users\n` +
    `• 💡 AI Innovator\n` +
    `• 👑 Alpha Developer\n\n` +
    `${E.link} **Connect:**\n` +
    `• Telegram: @KING_OF_ALPHA\n` +
    `• GitHub: mamme234\n` +
    `• Email: ghazimuhammadilyas@gmail.com\n\n` +
    `${E.heart} *Built with passion for the community!* ${E.heart}`,
    { parse_mode: "Markdown" }
  );
});

// ================= STATUS COMMAND =================
bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const user = getUser(userId);
  
  const isPremium = user.premium || user.isAdmin;
  const days = Math.floor((Date.now() - new Date(user.joinedDate).getTime()) / (1000 * 60 * 60 * 24));
  
  await bot.sendMessage(
    chatId,
    `${E.star} **YOUR PROFILE** ${E.star}\n\n` +
    `👤 **User ID:** \`${userId}\`\n` +
    `${user.isAdmin ? E.crown : ''} **Plan:** ${isPremium ? '💎 Premium' : '🆓 Free'}\n` +
    `📊 **Messages:** ${user.requests || 0}\n` +
    `${E.coin} **Coins:** ${user.coins || 0}\n` +
    `${E.image} **Images Generated:** ${user.imagesGenerated || 0}\n` +
    `${E.video} **Videos Processed:** ${user.videosProcessed || 0}\n` +
    `📅 **Days Active:** ${days}\n` +
    `🤖 **Model:** ${workingModel || 'N/A'}\n\n` +
    `${isPremium ? `${E.fire} Enjoy unlimited access! ${E.fire}` : `${E.diamond} Upgrade with /buy!`}`,
    { parse_mode: "Markdown" }
  );
});

// ================= BUY COMMAND =================
bot.onText(/\/buy/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const user = getUser(userId);
  
  if (user.isAdmin) {
    await bot.sendMessage(
      chatId,
      `${E.crown} **ADMIN ACCESS** ${E.crown}\n\nYou already have unlimited access!`
    );
    return;
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Alpha AI Pro - Premium Access",
              description: "Unlimited AI chat, images, video & photo editing"
            },
            unit_amount: 500,
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.WEBHOOK_URL}/success?user=${userId}`,
      cancel_url: `${process.env.WEBHOOK_URL}/cancel`,
      metadata: { userId: String(userId) }
    });

    await bot.sendMessage(
      chatId, 
      `${E.diamond} **UNLOCK ALPHA AI PRO** ${E.diamond}\n\n` +
      `💳 **Pay:** ${session.url}\n\n` +
      `🔒 **Only $5 - One Time Payment!**\n\n` +
      `**✨ Premium Features:**\n` +
      `${E.lightning} Unlimited AI Chat\n` +
      `${E.image} Unlimited Image Generation\n` +
      `${E.photo} Unlimited Photo Editing\n` +
      `${E.video} Unlimited Video Processing\n` +
      `${E.palette} Advanced Design Tools\n` +
      `${E.rocket} Priority Processing\n` +
      `${E.crown} Premium Support\n\n` +
      `${E.fire} *Upgrade now and unlock full power!* ${E.fire}`,
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    console.error("❌ Stripe error:", error);
    await bot.sendMessage(chatId, "⚠️ Payment system unavailable. Try again later.");
  }
});

// ================= RESET COMMAND =================
bot.onText(/\/reset/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  
  const user = getUser(userId);
  user.chatHistory = [];
  saveDB();
  
  await bot.sendMessage(
    chatId,
    `${E.magic} **RESET COMPLETE** ${E.magic}\n\nFresh start! Send any message.`
  );
});

// ================= MESSAGE HANDLER =================
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);

  if (!msg.text || msg.text.startsWith("/")) return;

  try {
    const user = getUser(userId);
    
    if (!modelInitialized) {
      await findWorkingModel();
      if (!modelInitialized) {
        throw new Error("Model not initialized");
      }
    }

    await bot.sendChatAction(chatId, "typing");

    const isPremium = user.premium || user.isAdmin;
    const maxFreeMessages = 5;

    if (!isPremium && user.requests >= maxFreeMessages) {
      await bot.sendMessage(
        chatId,
        `${E.fire} **FREE LIMIT REACHED** ${E.fire}\n\n` +
        `You've used ${user.requests} free messages.\n` +
        `${E.diamond} **Upgrade to Premium for unlimited access!**\n\n` +
        `Use /buy to upgrade.`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    user.chatHistory = user.chatHistory || [];
    user.chatHistory.push({ role: "user", text: msg.text });
    user.requests = (user.requests || 0) + 1;
    user.totalMessages = (user.totalMessages || 0) + 1;
    db.stats.totalMessages = (db.stats.totalMessages || 0) + 1;

    const maxHistory = isPremium ? 50 : 10;
    if (user.chatHistory.length > maxHistory) {
      user.chatHistory = user.chatHistory.slice(-maxHistory);
    }

    let context = "";
    for (const entry of user.chatHistory) {
      context += `${entry.role === 'user' ? 'User' : 'Assistant'}: ${entry.text}\n`;
    }

    // Professional ChatGPT-style prompt
    const systemPrompt = `You are Alpha AI Pro, a professional ChatGPT-style assistant. 
    You provide clear, detailed, and well-structured responses. 
    Use emojis appropriately to make responses engaging.
    Format responses with proper headings, bullet points, and sections when needed.
    
    Conversation:\n${context}\nAssistant: Provide a professional, detailed response.`;

    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [{ text: systemPrompt }]
        }
      ],
      generationConfig: {
        maxOutputTokens: isPremium ? 8192 : 2048,
        temperature: 0.7,
      }
    });

    const answer = result.response.text();

    user.chatHistory.push({ role: "assistant", text: answer });
    saveDB();

    // Send with professional formatting
    await bot.sendMessage(chatId, answer, { parse_mode: "Markdown" });

  } catch (error) {
    console.error("❌ Error:", error.message);
    await bot.sendMessage(
      chatId,
      `${E.sparkle} ⚠️ Error: ${error.message}\n\nPlease try again. ${E.sparkle}`
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
          `${E.diamond} **ALPHA AI PRO UNLOCKED!** ${E.diamond}\n\n` +
          `🎉 You now have unlimited access to all features!\n\n` +
          `${E.rocket} **What you get:**\n` +
          `• Unlimited AI Chat\n` +
          `• Unlimited Image Generation\n` +
          `• Unlimited Photo Editing\n` +
          `• Unlimited Video Processing\n` +
          `• Advanced Design Tools\n` +
          `• Priority Support\n\n` +
          `${E.fire} *Enjoy the full power of Alpha AI Pro!* ${E.fire}`,
          { parse_mode: "Markdown" }
        );
      }
    } catch (error) {
      console.error("❌ Success error:", error);
    }
  }

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Alpha AI Pro Unlocked</title>
      <style>
        body { 
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
          color: white; 
          text-align: center; 
          padding: 50px; 
          font-family: Arial, sans-serif;
          min-height: 100vh;
          display: flex;
          justify-content: center;
          align-items: center;
        }
        .card {
          background: rgba(255,255,255,0.1);
          backdrop-filter: blur(10px);
          padding: 40px;
          border-radius: 20px;
          max-width: 400px;
        }
        .emoji { font-size: 80px; }
        h1 { font-size: 2em; background: linear-gradient(135deg, #ffd700, #ff6b6b); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        p { color: #e0e0e0; }
        .features { text-align: left; margin: 20px 0; }
        .features li { list-style: none; padding: 5px 0; color: #ddd; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="emoji">🐺</div>
        <h1>Alpha AI Pro Unlocked!</h1>
        <p>Welcome to the Alpha Club!</p>
        <div class="features">
          <li>✅ Unlimited AI Chat</li>
          <li>✅ Unlimited Image Generation</li>
          <li>✅ Unlimited Photo Editing</li>
          <li>✅ Unlimited Video Processing</li>
        </div>
        <p style="font-size: 0.9em; opacity: 0.8; margin-top: 20px;">Close this window and return to Telegram</p>
      </div>
    </body>
    </html>
  `);
});

app.get("/cancel", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Cancelled</title>
      <style>
        body { 
          background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); 
          color: white; 
          text-align: center; 
          padding: 50px; 
          font-family: Arial, sans-serif;
          min-height: 100vh;
          display: flex;
          justify-content: center;
          align-items: center;
        }
        .card {
          background: rgba(255,255,255,0.1);
          backdrop-filter: blur(10px);
          padding: 40px;
          border-radius: 20px;
          max-width: 400px;
        }
        .emoji { font-size: 80px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="emoji">😅</div>
        <h1>Cancelled</h1>
        <p>You can try again anytime with /buy</p>
      </div>
    </body>
    </html>
  `);
});

// ================= WEB INTERFACE =================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ================= API ENDPOINTS =================
app.get("/api/status", (req, res) => {
  res.json({
    status: "✅ Online",
    model: workingModel,
    modelReady: modelInitialized,
    users: Object.keys(db.users).length,
    totalMessages: db.stats.totalMessages || 0,
    uptime: process.uptime()
  });
});

app.get("/api/user/:id", (req, res) => {
  const user = getUser(req.params.id);
  res.json({
    premium: user.premium,
    isAdmin: user.isAdmin,
    requests: user.requests,
    totalMessages: user.totalMessages,
    coins: user.coins || 0,
    imagesGenerated: user.imagesGenerated || 0,
    videosProcessed: user.videosProcessed || 0
  });
});

app.get("/api/owner", (req, res) => {
  res.json({
    name: OWNER.name,
    username: OWNER.username,
    bio: OWNER.bio,
    skills: OWNER.skills,
    achievements: OWNER.achievements,
    telegram: OWNER.telegram,
    github: OWNER.github,
    email: OWNER.email
  });
});

// ================= TEST ENDPOINTS =================
app.get("/test", async (req, res) => {
  try {
    if (!modelInitialized) {
      await findWorkingModel();
    }
    
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: "Say hello" }] }]
    });
    
    res.json({
      success: true,
      model: workingModel,
      response: result.response.text()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get("/debug", (req, res) => {
  res.json({
    model: workingModel,
    modelReady: modelInitialized,
    env: {
      bot_token: process.env.BOT_TOKEN ? "✅" : "❌",
      gemini_key: process.env.GEMINI_API_KEY ? "✅" : "❌",
      webhook_url: process.env.WEBHOOK_URL || "❌"
    },
    db_users: Object.keys(db.users).length,
    total_messages: db.stats.totalMessages || 0
  });
});

// ================= START SERVER =================
app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🤖 Working Model: ${workingModel || '❌ Not found'}`);
  console.log(`📊 Model Ready: ${modelInitialized}`);
  console.log(`👥 Users: ${Object.keys(db.users).length}`);
  console.log(`👑 Owner: ${OWNER.name} (@${OWNER.username})`);
  
  await setWebhook();
  
  console.log(`✅ Bot ready!`);
  console.log(`📋 Web: ${process.env.WEBHOOK_URL}/`);
  console.log(`📋 Test: ${process.env.WEBHOOK_URL}/test`);
  console.log(`📋 Debug: ${process.env.WEBHOOK_URL}/debug`);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});
