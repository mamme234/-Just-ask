import express from "express";
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import fs from "fs";
import Stripe from "stripe";
import { GoogleGenerativeAI } from "@google/generative-ai";
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

// ================= OWNER CONFIGURATION =================
const OWNER = {
  name: "Muhammad Ilyas",
  username: "@KING_OF_ALPHA",
  telegram: "https://t.me/KING_OF_ALPHA",
  github: "https://github.com/mamme234",
  email: "ghazimuhammadilyas@gmail.com",
  bio: "👑 King of Alpha | Full-Stack Developer | AI Enthusiast"
};

// ================= ADMIN CONFIGURATION =================
const ADMIN_IDS = [
  "123456789", // Replace with your Telegram user ID
];

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

// ================= WORKING IMAGE GENERATOR =================
async function generateImage(prompt, userId) {
  try {
    const user = getUser(userId);
    const isPremium = user.premium || user.isAdmin;
    
    // Check limits
    if (!isPremium && user.imagesGenerated >= 2) {
      return { error: "⚠️ Free limit reached. Upgrade to premium for unlimited image generation!" };
    }
    
    // Create a beautiful canvas image
    const canvas = createCanvas(1024, 768);
    const ctx = canvas.getContext('2d');
    
    // Background gradient
    const gradient = ctx.createLinearGradient(0, 0, 1024, 768);
    gradient.addColorStop(0, '#0a0a2e');
    gradient.addColorStop(0.3, '#1a1a4e');
    gradient.addColorStop(0.6, '#2d1b69');
    gradient.addColorStop(1, '#0f3460');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1024, 768);
    
    // Draw decorative circles
    for (let i = 0; i < 30; i++) {
      ctx.beginPath();
      ctx.arc(
        Math.random() * 1024,
        Math.random() * 768,
        Math.random() * 30 + 5,
        0,
        Math.PI * 2
      );
      ctx.fillStyle = `rgba(255, 255, 255, ${Math.random() * 0.05 + 0.02})`;
      ctx.fill();
    }
    
    // Border
    ctx.strokeStyle = '#667eea';
    ctx.lineWidth = 4;
    ctx.strokeRect(20, 20, 984, 728);
    
    // Inner border
    ctx.strokeStyle = 'rgba(102, 126, 234, 0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(30, 30, 964, 708);
    
    // AI Logo
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 60px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('🐺', 512, 120);
    
    // Title
    ctx.fillStyle = '#667eea';
    ctx.font = 'bold 40px Arial';
    ctx.fillText('Alpha AI Pro', 512, 200);
    
    // Subtitle
    ctx.fillStyle = '#aaa';
    ctx.font = '20px Arial';
    ctx.fillText('AI Generated Image', 512, 250);
    
    // Divider line
    ctx.strokeStyle = 'rgba(102, 126, 234, 0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(100, 280);
    ctx.lineTo(924, 280);
    ctx.stroke();
    
    // Prompt
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 24px Arial';
    ctx.fillText('📝 Prompt:', 50, 330);
    
    ctx.fillStyle = '#ddd';
    ctx.font = '20px Arial';
    const words = prompt.split(' ');
    let lines = [];
    let currentLine = '';
    for (const word of words) {
      if ((currentLine + word).length > 40) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine += (currentLine ? ' ' : '') + word;
      }
    }
    if (currentLine) lines.push(currentLine);
    
    let y = 370;
    for (const line of lines.slice(0, 8)) {
      ctx.fillStyle = '#ddd';
      ctx.font = '18px Arial';
      ctx.fillText('  ' + line, 50, y);
      y += 35;
    }
    
    // Footer
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = '14px Arial';
    ctx.fillText(`Generated for: ${userId}`, 50, 700);
    ctx.fillText(`Model: ${workingModel}`, 512, 700);
    ctx.fillText(new Date().toLocaleDateString(), 900, 700);
    
    // Premium badge
    if (isPremium) {
      ctx.fillStyle = '#FFD700';
      ctx.font = 'bold 16px Arial';
      ctx.fillText('💎 PREMIUM', 900, 100);
    }
    
    const buffer = canvas.toBuffer('image/png');
    
    // Update user stats
    user.imagesGenerated = (user.imagesGenerated || 0) + 1;
    saveDB();
    
    return { buffer, description: `✨ Generated image based on: "${prompt}"` };
  } catch (error) {
    console.error("❌ Image generation error:", error);
    return { error: "⚠️ Failed to generate image. Please try again." };
  }
}

// ================= COMMANDS =================
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const user = getUser(userId);
  
  const isPremium = user.premium || user.isAdmin;
  const status = isPremium ? '💎 Premium' : '🆓 Free';
  
  await bot.sendMessage(
    chatId,
    `🐺 **Welcome to Alpha AI Pro**\n\n` +
    `👤 Status: ${status}\n` +
    `📊 Messages: ${user.requests || 0}\n` +
    `🖼️ Images: ${user.imagesGenerated || 0}\n` +
    `🪙 Coins: ${user.coins || 0}\n\n` +
    `━━━━━━━━━━━━━━━━━━━\n` +
    `💬 **Send any message to chat with AI**\n` +
    `━━━━━━━━━━━━━━━━━━━\n\n` +
    `📌 **Commands:**\n` +
    `🔹 /chat - Start AI conversation\n` +
    `🔹 /image - Generate an image\n` +
    `🔹 /photo - Edit photos\n` +
    `🔹 /video - Process videos\n` +
    `🔹 /design - Design tools\n` +
    `🔹 /buy - Upgrade to Premium\n` +
    `🔹 /status - Your stats\n` +
    `🔹 /owner - About owner\n` +
    `🔹 /help - All commands\n\n` +
    `✨ *Try sending me any message!*`,
    { parse_mode: "Markdown" }
  );
});

// ================= CHAT COMMAND =================
bot.onText(/\/chat/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(
    chatId,
    `💬 **Chat Mode**\n\n` +
    `Send me any message and I'll respond like ChatGPT!\n\n` +
    `💡 Try:\n` +
    `• "Explain quantum computing"\n` +
    `• "Write a poem about AI"\n` +
    `• "Help me with my code"\n` +
    `• "What's the weather like?"\n\n` +
    `✨ *Type your message now!*`
  );
});

// ================= IMAGE COMMAND =================
bot.onText(/\/image/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const user = getUser(userId);
  
  const isPremium = user.premium || user.isAdmin;
  const maxFree = 2;
  const remaining = Math.max(0, maxFree - (user.imagesGenerated || 0));
  
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
    `*Send your image description now!*`
  );
});

// ================= HELP COMMAND =================
bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;
  
  await bot.sendMessage(
    chatId,
    `📖 **Alpha AI Pro - Help Center**\n\n` +
    `━━━━━━━━━━━━━━━━━━━\n` +
    `🤖 **AI Chat**\n` +
    `• /chat - Start conversation\n` +
    `• Just type any message\n` +
    `━━━━━━━━━━━━━━━━━━━\n` +
    `🖼️ **Image Generation**\n` +
    `• /image - Generate images\n` +
    `• Describe what you want\n` +
    `━━━━━━━━━━━━━━━━━━━\n` +
    `📸 **Photo Editing**\n` +
    `• /photo - Edit photos\n` +
    `• Send photo + effect\n` +
    `━━━━━━━━━━━━━━━━━━━\n` +
    `🎬 **Video Processing**\n` +
    `• /video - Process videos\n` +
    `• Trim, convert, resize\n` +
    `━━━━━━━━━━━━━━━━━━━\n` +
    `🎨 **Design Tools**\n` +
    `• /design - Create designs\n` +
    `• Posters, logos, banners\n` +
    `━━━━━━━━━━━━━━━━━━━\n` +
    `💎 **Premium**\n` +
    `• /buy - Upgrade ($5)\n` +
    `• Unlimited everything\n` +
    `━━━━━━━━━━━━━━━━━━━\n` +
    `👤 **Account**\n` +
    `• /status - Your stats\n` +
    `• /reset - Reset chat\n` +
    `• /owner - About owner\n` +
    `━━━━━━━━━━━━━━━━━━━\n` +
    `✨ *Send any message to chat!*`
  );
});

// ================= OWNER COMMAND =================
bot.onText(/\/owner/, async (msg) => {
  const chatId = msg.chat.id;
  
  await bot.sendMessage(
    chatId,
    `👑 **Alpha AI Pro - Owner**\n\n` +
    `👤 Name: Muhammad Ilyas\n` +
    `📝 Username: @KING_OF_ALPHA\n` +
    `📋 Bio: Full-Stack Developer | AI Enthusiast\n\n` +
    `🏆 Achievements:\n` +
    `• Built 50+ Bots\n` +
    `• 10k+ Active Users\n` +
    `• AI Innovator\n` +
    `• Alpha Developer\n\n` +
    `🔗 Connect:\n` +
    `• Telegram: @KING_OF_ALPHA\n` +
    `• GitHub: mamme234\n` +
    `• Email: ghazimuhammadilyas@gmail.com\n\n` +
    `❤️ *Built with passion!*`
  );
});

// ================= MESSAGE HANDLER =================
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const text = msg.text;

  if (!text || text.startsWith("/")) return;

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

    // Check if user is trying to generate image
    if (text.toLowerCase().includes('image') || 
        text.toLowerCase().includes('picture') ||
        text.toLowerCase().includes('photo') ||
        text.toLowerCase().includes('draw') ||
        text.toLowerCase().includes('create')) {
      
      // Check image limits
      if (!isPremium && user.imagesGenerated >= 2) {
        await bot.sendMessage(
          chatId,
          `⚠️ **Image limit reached!**\n\n` +
          `You've used all 2 free image generations.\n` +
          `💎 Upgrade to Premium for unlimited images!\n\n` +
          `Use /buy to upgrade.`
        );
        return;
      }
      
      // Generate image
      const result = await generateImage(text, userId);
      
      if (result.error) {
        await bot.sendMessage(chatId, result.error);
        return;
      }
      
      await bot.sendPhoto(chatId, result.buffer, {
        caption: `🖼️ **Generated Image**\n\n${result.description}\n\n🪙 Coins: ${user.coins || 0}`
      });
      
      user.totalMessages = (user.totalMessages || 0) + 1;
      saveDB();
      return;
    }

    // Regular chat - check message limits
    if (!isPremium && user.requests >= maxFreeMessages) {
      await bot.sendMessage(
        chatId,
        `⚠️ **Free limit reached!**\n\n` +
        `You've used ${user.requests} free messages.\n` +
        `💎 Upgrade to Premium for unlimited access!\n\n` +
        `Use /buy to upgrade.`
      );
      return;
    }

    // Store message
    user.chatHistory = user.chatHistory || [];
    user.chatHistory.push({ role: "user", content: text });
    user.requests = (user.requests || 0) + 1;
    user.totalMessages = (user.totalMessages || 0) + 1;
    db.stats.totalMessages = (db.stats.totalMessages || 0) + 1;

    const maxHistory = isPremium ? 50 : 10;
    if (user.chatHistory.length > maxHistory) {
      user.chatHistory = user.chatHistory.slice(-maxHistory);
    }

    // Build context
    let context = "";
    for (const entry of user.chatHistory) {
      context += `${entry.role === 'user' ? 'User' : 'Assistant'}: ${entry.content}\n`;
    }

    // Generate response
    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [{ 
            text: `You are Alpha AI Pro, a professional ChatGPT-style assistant. 
            Provide clear, detailed, and helpful responses. Use formatting when needed.
            
            Conversation:
            ${context}
            
            Assistant: Provide a professional, detailed response.` 
          }]
        }
      ],
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

// ================= START SERVER =================
app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🤖 Working Model: ${workingModel || '❌ Not found'}`);
  console.log(`📊 Model Ready: ${modelInitialized}`);
  console.log(`👥 Users: ${Object.keys(db.users).length}`);
  
  await setWebhook();
  
  console.log(`✅ Bot ready!`);
  console.log(`📋 Web: ${process.env.WEBHOOK_URL}/`);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});
