import express from "express";
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import fs from "fs";
import Stripe from "stripe";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ================= ADMIN CONFIGURATION =================
// 👑 Add your Telegram user ID(s) here for unlimited free access
const ADMIN_IDS = [
  "123456789", // ⭐ Replace with your Telegram user ID
  // Add more admin IDs if needed
];

// ================= EMOJI & STYLE CONFIGURATION =================
const STYLE = {
  premium: "💎",
  admin: "👑",
  free: "🆓",
  star: "⭐",
  sparkle: "✨",
  fire: "🔥",
  rocket: "🚀",
  brain: "🧠",
  magic: "🎯",
  gift: "🎁",
  crown: "👑",
  diamond: "💎",
  lightning: "⚡",
  robot: "🤖",
  heart: "❤️",
  thunder: "🌩️",
  spark: "💫"
};

// ================= VALIDATE ENV VARIABLES =================
console.log("🔍 Checking environment variables...");
console.log("BOT_TOKEN:", process.env.BOT_TOKEN ? "✅ Set" : "❌ Missing");
console.log("GEMINI_API_KEY:", process.env.GEMINI_API_KEY ? "✅ Set" : "❌ Missing");
console.log("STRIPE_SECRET_KEY:", process.env.STRIPE_SECRET_KEY ? "✅ Set" : "❌ Missing");
console.log("WEBHOOK_URL:", process.env.WEBHOOK_URL || "❌ Missing");

const requiredEnv = ['BOT_TOKEN', 'GEMINI_API_KEY', 'STRIPE_SECRET_KEY', 'WEBHOOK_URL'];
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

// ================= BEST MODEL SELECTION =================
const MODEL_NAME = process.env.GEMINI_MODEL || "gemini-3.5-flash";
console.log(`🤖 Using Gemini model: ${MODEL_NAME}`);

const BACKUP_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-flash-latest"
];

let model;
let currentModelName = MODEL_NAME;
let modelInitialized = false;

async function initializeModel() {
  try {
    console.log(`🔍 Initializing model: ${currentModelName}`);
    
    model = genAI.getGenerativeModel({ 
      model: currentModelName,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8192,
        topK: 40,
        topP: 0.95,
      }
    });
    
    const testResult = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: "Say hello" }] }]
    });
    
    console.log(`✅ Model ${currentModelName} is working!`);
    modelInitialized = true;
    return true;
    
  } catch (error) {
    console.error(`❌ Model ${currentModelName} failed:`, error.message);
    
    for (const backup of BACKUP_MODELS) {
      if (backup === currentModelName) continue;
      
      try {
        console.log(`🔄 Trying backup model: ${backup}`);
        const testModel = genAI.getGenerativeModel({ 
          model: backup,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 8192,
          }
        });
        
        await testModel.generateContent({
          contents: [{ role: "user", parts: [{ text: "Say hello" }] }]
        });
        
        console.log(`✅ Backup model ${backup} is working!`);
        currentModelName = backup;
        model = testModel;
        modelInitialized = true;
        return true;
        
      } catch (backupError) {
        console.error(`❌ Backup ${backup} failed:`, backupError.message);
      }
    }
    
    console.error("❌ No working model found!");
    modelInitialized = false;
    return false;
  }
}

// Initialize model on startup
await initializeModel();

// ================= DB =================
const DB_FILE = "./db.json";

function loadDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const initialData = { users: {}, stats: { totalMessages: 0, totalUsers: 0 } };
      fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
      return initialData;
    }
    const data = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error("❌ Error loading DB:", error);
    return { users: {}, stats: { totalMessages: 0, totalUsers: 0 } };
  }
}

let db = loadDB();

function saveDB() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (error) {
    console.error("❌ Error saving DB:", error);
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
      chatHistory: [],
      totalMessages: 0,
      joinedDate: new Date().toISOString(),
      errors: 0,
      adsWatched: 0,
      streak: 0,
      lastActive: new Date().toISOString()
    };
    db.stats.totalUsers = (db.stats.totalUsers || 0) + 1;
    saveDB();
    if (isAdmin) {
      console.log(`👑 Admin user registered: ${userId}`);
    }
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
    console.log('✅ Old webhook removed');
    
    const result = await bot.setWebHook(webhookUrl, {
      allowed_updates: ['message', 'callback_query']
    });
    
    if (result) {
      console.log("✅ Webhook set successfully!");
    } else {
      console.log("❌ Webhook set failed!");
    }
  } catch (error) {
    console.error("❌ Error setting webhook:", error.message);
  }
}

// Webhook endpoint
app.all(WEBHOOK_PATH, async (req, res) => {
  try {
    if (req.method === 'GET') {
      const webhookInfo = await bot.getWebHookInfo();
      return res.json({
        status: "✅ Webhook endpoint is active",
        webhook_info: webhookInfo
      });
    }
    
    await bot.processUpdate(req.body);
    res.sendStatus(200);
  } catch (error) {
    console.error("❌ Webhook error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ================= SEND LONG RESPONSE HELPER =================
async function sendLongMessage(chatId, text, options = {}) {
  const MAX_LENGTH = 4096;
  
  if (text.length <= MAX_LENGTH) {
    return await bot.sendMessage(chatId, text, options);
  }
  
  const chunks = [];
  let currentChunk = "";
  
  const paragraphs = text.split(/\n\n/);
  
  for (const paragraph of paragraphs) {
    if ((currentChunk + paragraph).length <= MAX_LENGTH) {
      currentChunk += (currentChunk ? "\n\n" : "") + paragraph;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk);
      }
      if (paragraph.length > MAX_LENGTH) {
        const sentences = paragraph.split(/(?<=[.!?])\s+/);
        currentChunk = "";
        for (const sentence of sentences) {
          if ((currentChunk + sentence).length <= MAX_LENGTH) {
            currentChunk += (currentChunk ? " " : "") + sentence;
          } else {
            if (currentChunk) {
              chunks.push(currentChunk);
            }
            currentChunk = sentence;
          }
        }
      } else {
        currentChunk = paragraph;
      }
    }
  }
  
  if (currentChunk) {
    chunks.push(currentChunk);
  }
  
  const messages = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    let prefix = chunks.length > 1 ? `📝 **Part ${i+1}/${chunks.length}**\n\n` : "";
    const messageText = prefix + chunk;
    const sent = await bot.sendMessage(chatId, messageText, options);
    messages.push(sent);
    
    if (i < chunks.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
  
  if (chunks.length > 1) {
    await bot.sendMessage(
      chatId,
      `${STYLE.sparkle} **Full response sent (${chunks.length} parts)** ${STYLE.sparkle}\n\n📊 Total: ${text.length} characters`,
      { parse_mode: "Markdown" }
    );
  }
  
  return messages;
}

// ================= CREATE ATTRACTIVE MESSAGE =================
function createAttractiveMessage(user, type = 'welcome') {
  const status = user.premium ? `${STYLE.premium} Premium` : `${STYLE.free} Free`;
  const adminBadge = user.isAdmin ? ` ${STYLE.admin} Admin` : '';
  const days = Math.floor((Date.now() - new Date(user.joinedDate).getTime()) / (1000 * 60 * 60 * 24));
  
  const messages = {
    welcome: `
${STYLE.fire} **WELCOME TO ULTIMATE AI ASSISTANT** ${STYLE.fire}

${STYLE.robot} *Your Personal AI Powerhouse*

━━━━━━━━━━━━━━━━━━━━━
${STYLE.star} **Status:** ${status}${adminBadge}
${STYLE.sparkle} **Messages:** ${user.requests || 0}/∞
${STYLE.crown} **Rank:** ${user.isAdmin ? '👑 Admin' : user.premium ? '💎 Elite' : '🆓 Explorer'}
${STYLE.heart} **Days Active:** ${days}
━━━━━━━━━━━━━━━━━━━━━

${STYLE.magic} **What I Can Do For You:**
• ${STYLE.brain} Answer any question
• ${STYLE.lightning} Write code in any language
• ${STYLE.spark} Creative content writing
• ${STYLE.rocket} Research & analysis
• ${STYLE.gift} Professional advice

━━━━━━━━━━━━━━━━━━━━━
**📌 Commands:**
${STYLE.diamond} /buy - Unlock Premium ($5)
${STYLE.star} /status - Your Stats
${STYLE.sparkle} /reset - Fresh Start
${STYLE.robot} /model - AI Info
${STYLE.heart} /help - All Commands
━━━━━━━━━━━━━━━━━━━━━

${STYLE.fire} *Just send me any message to start!* ${STYLE.fire}
    `,
    premium: `
${STYLE.diamond} **PREMIUM UNLOCKED** ${STYLE.diamond}

${STYLE.fire} Congratulations! You're now Elite!

━━━━━━━━━━━━━━━━━━━━━
${STYLE.star} **Premium Benefits:**
• ${STYLE.lightning} Unlimited messages
• ${STYLE.rocket} 8192 token responses
• ${STYLE.brain} Advanced AI model
• ${STYLE.crown} Priority support
• ${STYLE.spark} Exclusive features
━━━━━━━━━━━━━━━━━━━━━

${STYLE.magic} *Enjoy the full power of AI!* ${STYLE.magic}
    `,
    admin: `
${STYLE.crown} **ADMIN ACCESS GRANTED** ${STYLE.crown}

${STYLE.fire} Welcome to the Admin Zone!

━━━━━━━━━━━━━━━━━━━━━
${STYLE.star} **Admin Benefits:**
• ${STYLE.lightning} Unlimited everything
• ${STYLE.rocket} Full model access
• ${STYLE.crown} Priority processing
• ${STYLE.brain} Debug access
• ${STYLE.gift} Exclusive features
━━━━━━━━━━━━━━━━━━━━━

${STYLE.thunder} *You have full control!* ${STYLE.thunder}
    `
  };
  
  return messages[type] || messages.welcome;
}

// ================= PAYMENT LINK =================
bot.onText(/\/buy/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  
  const user = getUser(userId);
  
  if (user.isAdmin) {
    await bot.sendMessage(
      chatId,
      `${STYLE.crown} **ADMIN ACCESS** ${STYLE.crown}\n\n` +
      "You already have unlimited premium access for free!\n\n" +
      `${STYLE.fire} Enjoy the full power of AI! ${STYLE.fire}`,
      { parse_mode: "Markdown" }
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
              name: "AI Bot Premium Access",
              description: `Unlimited AI chat access with ${currentModelName}`
            },
            unit_amount: 500,
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.WEBHOOK_URL}/success?user=${userId}`,
      cancel_url: `${process.env.WEBHOOK_URL}/cancel`,
      metadata: {
        userId: String(userId)
      }
    });

    await bot.sendMessage(
      chatId, 
      `${STYLE.diamond} **UNLOCK PREMIUM** ${STYLE.diamond}\n\n` +
      `💳 **Pay here:** ${session.url}\n\n` +
      `🔒 **Only $5 for unlimited access!**\n\n` +
      `${STYLE.fire} **Premium Features:**\n` +
      `• ${STYLE.lightning} Unlimited messages\n` +
      `• ${STYLE.rocket} 8192 token responses\n` +
      `• ${STYLE.brain} Advanced AI model\n` +
      `• ${STYLE.crown} Priority support\n` +
      `• ${STYLE.spark} Exclusive features\n\n` +
      `${STYLE.magic} *Don't wait, upgrade now!* ${STYLE.magic}`,
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    console.error("❌ Stripe error:", error);
    await bot.sendMessage(chatId, "⚠️ Payment system temporarily unavailable. Please try again later.");
  }
});

// ================= STRIPE SUCCESS =================
app.get("/success", async (req, res) => {
  const userId = req.query.user;
  const sessionId = req.query.session_id;

  if (userId) {
    try {
      if (sessionId) {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (session.payment_status === 'paid') {
          const user = getUser(userId);
          user.premium = true;
          user.requests = 0;
          saveDB();
          
          await bot.sendMessage(
            userId, 
            `${STYLE.diamond} **PREMIUM UNLOCKED!** ${STYLE.diamond}\n\n` +
            `${STYLE.fire} Congratulations! You now have full access! 🎉\n\n` +
            `${STYLE.sparkle} **What you get:**\n` +
            `• ${STYLE.lightning} Unlimited messages\n` +
            `• ${STYLE.rocket} 8192 token responses\n` +
            `• ${STYLE.brain} Advanced AI: ${currentModelName}\n` +
            `• ${STYLE.crown} Priority support\n\n` +
            `${STYLE.magic} *Start exploring the full AI power now!* ${STYLE.magic}`,
            { parse_mode: "Markdown" }
          );
        }
      }
    } catch (error) {
      console.error("❌ Error processing success:", error);
    }
  }

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Payment Successful</title>
      <style>
        body { font-family: Arial; text-align: center; padding: 50px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; }
        .success { color: #4CAF50; font-size: 64px; }
        .card { background: rgba(255,255,255,0.1); backdrop-filter: blur(10px); padding: 40px; border-radius: 20px; max-width: 500px; margin: 0 auto; }
        h1 { color: #fff; font-size: 2.5em; }
        p { color: #e0e0e0; }
        .emoji { font-size: 48px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="emoji">🎉</div>
        <h1>Payment Successful!</h1>
        <p>You now have premium access!</p>
        <p style="font-size: 14px; margin-top: 20px;">💎 Welcome to the Elite Club!</p>
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
      <title>Payment Cancelled</title>
      <style>
        body { font-family: Arial; text-align: center; padding: 50px; background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; }
        .cancel { color: #f44336; font-size: 64px; }
        .card { background: rgba(255,255,255,0.1); backdrop-filter: blur(10px); padding: 40px; border-radius: 20px; max-width: 500px; margin: 0 auto; }
        h1 { color: #fff; }
        p { color: #e0e0e0; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="emoji">😅</div>
        <h1>Payment Cancelled</h1>
        <p>You can try again anytime using /buy in Telegram.</p>
        <p style="font-size: 14px; margin-top: 20px;">💫 We're here when you're ready!</p>
      </div>
    </body>
    </html>
  `);
});

// ================= AI CHAT WITH ATTRACTIVE RESPONSES =================
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);

  if (!msg.text || msg.text.startsWith("/")) {
    return;
  }

  console.log(`📨 Message from ${userId}: "${msg.text.substring(0, 50)}..."`);
  
  try {
    if (!modelInitialized) {
      await initializeModel();
      if (!modelInitialized) {
        throw new Error("Model failed to initialize");
      }
    }
    
    const user = getUser(userId);
    const isAdmin = user.isAdmin;
    const isPremium = user.premium;

    user.requests = (user.requests || 0) + 1;
    user.totalMessages = (user.totalMessages || 0) + 1;
    user.lastActive = new Date().toISOString();
    db.stats.totalMessages = (db.stats.totalMessages || 0) + 1;

    // Check limits - Admin and Premium have unlimited
    const maxFreeMessages = 10;
    if (!isAdmin && !isPremium && user.requests > maxFreeMessages) {
      await bot.sendMessage(
        chatId,
        `${STYLE.fire} **FREE LIMIT REACHED** ${STYLE.fire}\n\n` +
        "You've used all 10 free messages.\n\n" +
        `${STYLE.diamond} **Unlock Premium for only $5!**\n` +
        "• Unlimited messages\n" +
        "• Longer responses\n" +
        "• Priority support\n\n" +
        `Use /buy to upgrade now! ${STYLE.rocket}`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    await bot.sendChatAction(chatId, "typing");

    // Store user message
    user.chatHistory = user.chatHistory || [];
    user.chatHistory.push({ role: "user", text: msg.text });

    const maxHistory = (isAdmin || isPremium) ? 50 : 20;
    if (user.chatHistory.length > maxHistory) {
      user.chatHistory = user.chatHistory.slice(-maxHistory);
    }

    // Build conversation context
    let conversationContext = "";
    for (const entry of user.chatHistory) {
      const role = entry.role === 'user' ? 'User' : 'Assistant';
      conversationContext += `${role}: ${entry.text}\n`;
    }

    console.log(`🤖 Sending to Gemini (${currentModelName}) for user ${userId}`);

    // Prepare prompt with personality
    const systemPrompt = `You are an amazing, helpful, and enthusiastic AI assistant. 
    Be creative, detailed, and engaging in your responses. 
    Use emojis to make responses more lively and fun.
    
    Conversation history:
    ${conversationContext}
    
    Assistant: Provide a complete, helpful, and engaging response with emojis.`;

    // API call with higher token limit for premium/admin
    const maxTokens = (isAdmin || isPremium) ? 8192 : 4096;
    
    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [{ text: systemPrompt }]
        }
      ],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: (isAdmin || isPremium) ? 0.8 : 0.7,
        topK: 40,
        topP: 0.95,
      }
    });

    const fullAnswer = result.response.text();

    user.chatHistory.push({ role: "assistant", text: fullAnswer });
    saveDB();

    // Send with attractive formatting
    await sendLongMessage(chatId, fullAnswer, { parse_mode: "Markdown" });

  } catch (error) {
    console.error("❌ Gemini AI error:", error);
    
    const user = getUser(userId);
    user.errors = (user.errors || 0) + 1;
    saveDB();
    
    let errorMessage = "⚠️ Sorry, I'm having trouble. Please try again.";
    
    if (error.message.includes("API key")) {
      errorMessage = "🔑 API key issue. Contact admin.";
    } else if (error.message.includes("quota")) {
      errorMessage = "📊 Quota exceeded. Try again later.";
    } else if (error.message.includes("safety")) {
      errorMessage = "🛡️ Safety guidelines prevented this response.";
    } else if (error.message.includes("timeout")) {
      errorMessage = "⏰ Request timed out. Please try again.";
    }
    
    await bot.sendMessage(chatId, `${STYLE.sparkle} ${errorMessage} ${STYLE.sparkle}`);
  }
});

// ================= ATTRACTIVE COMMANDS =================
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  
  const user = getUser(userId);
  
  // Show welcome message based on user type
  let welcomeMessage;
  if (user.isAdmin) {
    welcomeMessage = createAttractiveMessage(user, 'admin');
  } else if (user.premium) {
    welcomeMessage = createAttractiveMessage(user, 'premium');
  } else {
    welcomeMessage = createAttractiveMessage(user, 'welcome');
  }
  
  await bot.sendMessage(
    chatId,
    welcomeMessage,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const user = getUser(userId);
  const isPremium = user.premium || user.isAdmin;
  
  await bot.sendMessage(
    chatId,
    `${STYLE.star} **COMPLETE COMMAND LIST** ${STYLE.star}\n\n` +
    `${STYLE.robot} **Core Commands:**\n` +
    `/start - ${STYLE.fire} Welcome & Setup\n` +
    `/help - ${STYLE.star} This Menu\n` +
    `/status - ${STYLE.sparkle} Your Stats\n` +
    `/reset - ${STYLE.magic} Fresh Start\n` +
    `/model - ${STYLE.brain} AI Info\n\n` +
    `${STYLE.diamond} **Premium Commands:**\n` +
    `/buy - ${STYLE.gift} Upgrade to Premium\n\n` +
    `${STYLE.crown} **Admin Commands:**\n` +
    `/admin - ${STYLE.crown} Admin Panel\n` +
    `/stats - ${STYLE.star} Global Stats\n\n` +
    `${STYLE.fire} *Send any message to chat with AI!* ${STYLE.fire}`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  
  const user = getUser(userId);
  const days = Math.floor((Date.now() - new Date(user.joinedDate).getTime()) / (1000 * 60 * 60 * 24));
  
  const statusBar = user.premium ? 
    `${STYLE.diamond}████████████████████ ${STYLE.premium}` : 
    `${STYLE.free}████████░░░░░░░░░░░░ ${STYLE.free}`;
  
  await bot.sendMessage(
    chatId,
    `${STYLE.star} **YOUR PROFILE** ${STYLE.star}\n\n` +
    `👤 **User ID:** \`${userId}\`\n` +
    `${user.isAdmin ? STYLE.crown : ''} **Rank:** ${user.isAdmin ? '👑 Admin' : user.premium ? '💎 Elite' : '🆓 Explorer'}\n` +
    `${STYLE.sparkle} **Messages:** ${user.totalMessages || 0}\n` +
    `${STYLE.lightning} **Requests:** ${user.requests || 0}\n` +
    `${STYLE.heart} **Days Active:** ${days}\n` +
    `${STYLE.brain} **Model:** ${currentModelName}\n` +
    `${STYLE.rocket} **Status:** ${statusBar}\n\n` +
    `${user.premium ? `${STYLE.fire} You're Premium! ${STYLE.fire}` : `${STYLE.gift} Upgrade with /buy! ${STYLE.gift}`}`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/reset/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  
  const user = getUser(userId);
  user.chatHistory = [];
  user.requests = user.premium ? 0 : 0;
  saveDB();
  
  await bot.sendMessage(
    chatId,
    `${STYLE.magic} **FRESH START** ${STYLE.magic}\n\n` +
    `${STYLE.sparkle} Conversation reset successfully!\n` +
    `${STYLE.robot} Ready for new questions.\n\n` +
    `${STYLE.fire} *Send me anything!* ${STYLE.fire}`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/model/, async (msg) => {
  const chatId = msg.chat.id;
  
  await bot.sendMessage(
    chatId,
    `${STYLE.brain} **AI MODEL INFO** ${STYLE.brain}\n\n` +
    `📦 **Model:** ${currentModelName}\n` +
    `🏢 **Provider:** Google Gemini\n` +
    `📊 **Type:** ${currentModelName.includes('pro') ? 'Pro' : 'Flash'}\n` +
    `⚡ **Status:** ${modelInitialized ? '✅ Active' : '❌ Offline'}\n` +
    `🔢 **Token Limit:** 8192\n\n` +
    `**Available Models:**\n` +
    `• ${STYLE.star} gemini-3.5-flash (Best)\n` +
    `• ${STYLE.sparkle} gemini-2.5-flash\n` +
    `• ${STYLE.lightning} gemini-2.0-flash\n\n` +
    `${STYLE.magic} *Premium unlocks full potential!* ${STYLE.magic}`,
    { parse_mode: "Markdown" }
  );
});

// ================= ADMIN COMMANDS =================
bot.onText(/\/admin/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const user = getUser(userId);
  
  if (!user.isAdmin) {
    await bot.sendMessage(
      chatId,
      `${STYLE.fire} ⛔ **ACCESS DENIED** ${STYLE.fire}\n\n` +
      "This command is for admins only.",
      { parse_mode: "Markdown" }
    );
    return;
  }
  
  await bot.sendMessage(
    chatId,
    `${STYLE.crown} **ADMIN PANEL** ${STYLE.crown}\n\n` +
    `📊 **Global Stats:**\n` +
    `• Users: ${db.stats.totalUsers || 0}\n` +
    `• Total Messages: ${db.stats.totalMessages || 0}\n` +
    `• Active Model: ${currentModelName}\n\n` +
    `${STYLE.sparkle} **Admin Privileges:**\n` +
    `• Unlimited everything\n` +
    `• Full model access\n` +
    `• Priority processing\n\n` +
    `${STYLE.star} *You're in control!* ${STYLE.star}`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/stats/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const user = getUser(userId);
  
  if (!user.isAdmin) {
    await bot.sendMessage(
      chatId,
      `${STYLE.fire} ⛔ Access Denied`,
      { parse_mode: "Markdown" }
    );
    return;
  }
  
  const totalUsers = Object.keys(db.users).length;
  const premiumUsers = Object.values(db.users).filter(u => u.premium).length;
  const adminUsers = Object.values(db.users).filter(u => u.isAdmin).length;
  
  await bot.sendMessage(
    chatId,
    `${STYLE.star} **GLOBAL STATISTICS** ${STYLE.star}\n\n` +
    `👥 **Total Users:** ${totalUsers}\n` +
    `${STYLE.diamond} **Premium Users:** ${premiumUsers}\n` +
    `${STYLE.crown} **Admins:** ${adminUsers}\n` +
    `${STYLE.sparkle} **Total Messages:** ${db.stats.totalMessages || 0}\n` +
    `${STYLE.brain} **AI Model:** ${currentModelName}\n` +
    `${STYLE.lightning} **Status:** ${modelInitialized ? '✅ Online' : '❌ Offline'}\n\n` +
    `${STYLE.fire} *System running smoothly!* ${STYLE.fire}`,
    { parse_mode: "Markdown" }
  );
});

// ================= TEST ENDPOINTS =================
app.get("/test-gemini", async (req, res) => {
  try {
    if (!modelInitialized) {
      await initializeModel();
    }
    
    const result = await model.generateContent({
      contents: [{ 
        role: "user", 
        parts: [{ text: "Say hello and tell me your model name" }] 
      }]
    });
    res.json({
      success: true,
      response: result.response.text(),
      model: currentModelName,
      status: "✅ Working perfectly",
      features: {
        maxTokens: 8192,
        supportsLongResponses: true
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      model: currentModelName
    });
  }
});

app.get("/list-models", async (req, res) => {
  try {
    const models = await genAI.listModels();
    const modelNames = models.models.map(m => m.name.replace('models/', ''));
    res.json({
      success: true,
      available_models: modelNames,
      current_model: currentModelName,
      total: models.models.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================= WEBHOOK ENDPOINTS =================
app.get("/webhook-status", async (req, res) => {
  try {
    const webhookInfo = await bot.getWebHookInfo();
    res.json({
      status: "Webhook status",
      webhook_info: webhookInfo,
      current_url: `${process.env.WEBHOOK_URL}${WEBHOOK_PATH}`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/reset-webhook", async (req, res) => {
  try {
    await bot.setWebHook('', { drop_pending_updates: true });
    res.json({ message: "Webhook reset successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/set-webhook", async (req, res) => {
  try {
    const baseUrl = process.env.WEBHOOK_URL.replace(/\/$/, '');
    const webhookUrl = `${baseUrl}${WEBHOOK_PATH}`;
    const result = await bot.setWebHook(webhookUrl, {
      allowed_updates: ['message', 'callback_query']
    });
    res.json({ 
      message: "Webhook set successfully",
      url: webhookUrl,
      result: result
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================= HEALTH CHECK =================
app.get("/", (req, res) => {
  res.json({
    status: "✅ Bot is running!",
    version: "8.0.0",
    model: currentModelName,
    modelStatus: modelInitialized ? "✅ Active" : "❌ Inactive",
    timestamp: new Date().toISOString(),
    features: {
      adminFree: true,
      premiumTier: true,
      longResponses: true,
      autoChunking: true,
      attractiveUI: true
    }
  });
});

app.get("/health", (req, res) => {
  res.json({ 
    status: "healthy",
    uptime: process.uptime(),
    users: Object.keys(db.users).length,
    model: currentModelName,
    modelStatus: modelInitialized ? "online" : "offline"
  });
});

// ================= START SERVER =================
app.listen(PORT, async () => {
  console.log(`${STYLE.fire}🚀 ${STYLE.fire} SERVER STARTED ${STYLE.fire}🚀 ${STYLE.fire}`);
  console.log(`📡 Webhook: ${process.env.WEBHOOK_URL}${WEBHOOK_PATH}`);
  console.log(`🤖 AI Model: ${currentModelName}`);
  console.log(`👑 Admins: ${ADMIN_IDS.length}`);
  console.log(`📊 Status: ${modelInitialized ? '✅ Online' : '❌ Offline'}`);
  
  await setWebhook();
  
  console.log(`✅ Bot is ready!`);
  console.log(`👥 Users in DB: ${Object.keys(db.users).length}`);
  console.log(`${STYLE.sparkle}✨ Bot is now ATTRACTIVE & POWERFUL! ✨${STYLE.sparkle}`);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled Rejection:', error);
});
