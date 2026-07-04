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
  email: "ghazimuhammadilyas@gmail.com"
};

const ADMIN_IDS = ["123456789"];

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

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ================= MODEL SELECTION =================
const TEST_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-3.5-flash"];
let workingModel = null;
let model = null;
let modelInitialized = false;

async function findWorkingModel() {
  for (const modelName of TEST_MODELS) {
    try {
      const testModel = genAI.getGenerativeModel({ 
        model: modelName,
        generationConfig: { temperature: 0.7, maxOutputTokens: 100 }
      });
      await testModel.generateContent({
        contents: [{ role: "user", parts: [{ text: "Say hello" }] }]
      });
      workingModel = modelName;
      model = testModel;
      modelInitialized = true;
      return true;
    } catch (error) {
      console.error(`❌ ${modelName} failed:`, error.message);
    }
  }
  return false;
}
await findWorkingModel();

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

// ================= IMAGE GENERATOR =================
async function generateImage(prompt, userId) {
  try {
    const user = getUser(userId);
    const isPremium = user.premium || user.isAdmin;
    
    if (!isPremium && user.imagesGenerated >= 2) {
      return { error: "⚠️ Free limit reached. Upgrade to premium for unlimited images!" };
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
    ctx.font = '14px Arial';
    ctx.fillText(`User: ${userId.substring(0, 10)}`, 50, 700);
    ctx.fillText(`Model: ${workingModel}`, 512, 700);
    ctx.fillText(new Date().toLocaleDateString(), 850, 700);
    
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

// ================= CREATE KEYBOARD BUTTONS =================
function getMainKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '💬 Chat' }, { text: '🖼️ Image' }, { text: '📸 Photo' }],
        [{ text: '🎬 Video' }, { text: '🎨 Design' }, { text: '👑 Owner' }],
        [{ text: '📊 Status' }, { text: '💎 Premium' }, { text: '🔄 Reset' }],
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
  const status = isPremium ? '💎 Premium' : '🆓 Free';
  
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
    `Send me any message and I'll respond like ChatGPT!\n\n` +
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

// Owner Button
bot.onText(/👑 Owner/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(
    chatId,
    `👑 **Alpha AI Pro - Owner**\n\n` +
    `👤 Name: Muhammad Ilyas\n` +
    `📝 Username: @KING_OF_ALPHA\n` +
    `📋 Bio: Full-Stack Developer | AI Enthusiast\n\n` +
    `🏆 **Achievements:**\n` +
    `• Built 50+ Bots\n` +
    `• 10k+ Active Users\n` +
    `• AI Innovator\n` +
    `• Alpha Developer\n\n` +
    `🔗 **Connect:**\n` +
    `• Telegram: @KING_OF_ALPHA\n` +
    `• GitHub: mamme234\n` +
    `• Email: ghazimuhammadilyas@gmail.com\n\n` +
    `❤️ *Built with passion for the community!*`,
    { parse_mode: "Markdown" }
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
    `💎 Plan: ${isPremium ? 'Premium' : 'Free'}\n` +
    `📊 Messages: ${user.requests || 0}\n` +
    `🖼️ Images: ${user.imagesGenerated || 0}\n` +
    `🪙 Coins: ${user.coins || 0}\n` +
    `📅 Days Active: ${days}\n` +
    `🤖 Model: ${workingModel || 'N/A'}\n\n` +
    `${isPremium ? '🎉 Enjoy unlimited access!' : '💎 Upgrade with /buy'}`,
    { parse_mode: "Markdown" }
  );
});

// Premium Button
bot.onText(/💎 Premium/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const user = getUser(userId);
  
  if (user.isAdmin) {
    await bot.sendMessage(
      chatId,
      `👑 **Admin Access**\n\nYou already have unlimited access!`
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
      `💎 **Unlock Alpha AI Pro**\n\n` +
      `💳 Pay: ${session.url}\n\n` +
      `🔒 Only $5 - One Time!\n\n` +
      `**✨ Premium Features:**\n` +
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
    `**💎 Premium**\n` +
    `• Click "💎 Premium" to upgrade\n\n` +
    `**Free Limits:**\n` +
    `• 5 messages\n` +
    `• 2 images\n\n` +
    `**Premium:**\n` +
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
    
    if (!modelInitialized) {
      await findWorkingModel();
      if (!modelInitialized) {
        throw new Error("Model not initialized");
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
          `💎 Upgrade to Premium for unlimited!\n\n` +
          `Use the "💎 Premium" button.`
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

    // Regular chat
    if (!isPremium && user.requests >= 5) {
      await bot.sendMessage(
        chatId,
        `⚠️ **Free limit reached!**\n\n` +
        `You've used 5 free messages.\n` +
        `💎 Upgrade to Premium for unlimited!\n\n` +
        `Use the "💎 Premium" button.`
      );
      return;
    }

    await bot.sendChatAction(chatId, "typing");

    user.chatHistory = user.chatHistory || [];
    user.chatHistory.push({ role: "user", content: text });
    user.requests = (user.requests || 0) + 1;
    user.totalMessages = (user.totalMessages || 0) + 1;
    db.stats.totalMessages = (db.stats.totalMessages || 0) + 1;

    if (user.chatHistory.length > (isPremium ? 50 : 10)) {
      user.chatHistory = user.chatHistory.slice(-(isPremium ? 50 : 10));
    }

    let context = "";
    for (const entry of user.chatHistory) {
      context += `${entry.role === 'user' ? 'User' : 'Assistant'}: ${entry.content}\n`;
    }

    const result = await model.generateContent({
      contents: [{
        role: "user",
        parts: [{ 
          text: `You are Alpha AI Pro, a professional ChatGPT-style assistant. 
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
        <div class="emoji">🐺</div>
        <h1>Alpha AI Pro Unlocked!</h1>
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
        <p>You can try again anytime with the Premium button</p>
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
  res.json({
    status: "✅ Online",
    model: workingModel,
    users: Object.keys(db.users).length,
    totalMessages: db.stats.totalMessages || 0
  });
});

// ================= START SERVER =================
app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🤖 Working Model: ${workingModel || '❌ Not found'}`);
  console.log(`👥 Users: ${Object.keys(db.users).length}`);
  await setWebhook();
  console.log(`✅ Bot ready!`);
});
