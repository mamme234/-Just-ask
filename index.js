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

// ================= SELECT BEST AVAILABLE MODEL =================
// Based on your available models, using the best one
// You can change this to any model from the list above

// Option 1: Use the latest Gemini 3.5 Flash (BEST)
const MODEL_NAME = process.env.GEMINI_MODEL || "gemini-3.5-flash";

// Option 2: Use Gemini 2.5 Flash (Also great)
// const MODEL_NAME = process.env.GEMINI_MODEL || "gemini-2.5-flash";

// Option 3: Use auto-detection (fallback to best available)
// const MODEL_NAME = process.env.GEMINI_MODEL || "auto";

console.log(`🤖 Using Gemini model: ${MODEL_NAME}`);

// List of backup models if the primary fails
const BACKUP_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-flash-latest",
  "gemini-1.5-flash"
];

let model;
let currentModelName = MODEL_NAME;

async function initializeModel() {
  try {
    console.log(`🔍 Initializing model: ${currentModelName}`);
    
    model = genAI.getGenerativeModel({ 
      model: currentModelName,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1000,
        topK: 40,
        topP: 0.95,
      }
    });
    
    // Test the model with a simple request
    const testResult = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: "Say hello" }] }]
    });
    
    console.log(`✅ Model ${currentModelName} is working!`);
    return true;
    
  } catch (error) {
    console.error(`❌ Model ${currentModelName} failed:`, error.message);
    
    // Try backup models
    for (const backup of BACKUP_MODELS) {
      if (backup === currentModelName) continue;
      
      try {
        console.log(`🔄 Trying backup model: ${backup}`);
        const testModel = genAI.getGenerativeModel({ 
          model: backup,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1000,
          }
        });
        
        await testModel.generateContent({
          contents: [{ role: "user", parts: [{ text: "Say hello" }] }]
        });
        
        console.log(`✅ Backup model ${backup} is working!`);
        currentModelName = backup;
        model = testModel;
        return true;
        
      } catch (backupError) {
        console.error(`❌ Backup ${backup} failed:`, backupError.message);
      }
    }
    
    console.error("❌ No working model found!");
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
      const initialData = { users: {} };
      fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
      return initialData;
    }
    const data = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error("❌ Error loading DB:", error);
    return { users: {} };
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
    db.users[userId] = {
      premium: false,
      requests: 0,
      chatHistory: []
    };
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
        webhook_info: webhookInfo,
        method: "GET (testing)",
        note: "Send POST requests for bot updates"
      });
    }
    
    await bot.processUpdate(req.body);
    res.sendStatus(200);
  } catch (error) {
    console.error("❌ Webhook error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ================= PAYMENT LINK =================
bot.onText(/\/buy/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

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
      `💳 **Pay here to unlock premium access:**\n${session.url}\n\n🔒 Only $5 for unlimited access!`,
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
            "🎉 **Payment successful!** \n\nYou now have premium access. Enjoy unlimited AI chat! 🚀",
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
        body { font-family: Arial; text-align: center; padding: 50px; }
        .success { color: #4CAF50; font-size: 48px; }
      </style>
    </head>
    <body>
      <div class="success">✅</div>
      <h1>Payment Successful!</h1>
      <p>You can now close this window and return to Telegram.</p>
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
        body { font-family: Arial; text-align: center; padding: 50px; }
        .cancel { color: #f44336; font-size: 48px; }
      </style>
    </head>
    <body>
      <div class="cancel">❌</div>
      <h1>Payment Cancelled</h1>
      <p>You can try again anytime using /buy in Telegram.</p>
    </body>
    </html>
  `);
});

// ================= AI CHAT WITH GEMINI =================
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);

  if (!msg.text || msg.text.startsWith("/")) return;

  try {
    const user = getUser(userId);

    user.requests = (user.requests || 0) + 1;

    if (!user.premium && user.requests > 10) {
      await bot.sendMessage(
        chatId,
        "🚫 **Free limit reached!**\n\n" +
        "You've used all 10 free messages.\n" +
        "Use /buy to unlock premium access for only $5! 💰\n\n" +
        "✨ Premium benefits:\n" +
        "• Unlimited messages\n" +
        "• Priority response\n" +
        `• Access to ${currentModelName}`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    await bot.sendChatAction(chatId, "typing");

    user.chatHistory = user.chatHistory || [];
    user.chatHistory.push({ role: "user", text: msg.text });

    if (user.chatHistory.length > 20) {
      user.chatHistory = user.chatHistory.slice(-20);
    }

    // Build conversation context
    let conversationContext = "";
    for (const entry of user.chatHistory) {
      conversationContext += `${entry.role === 'user' ? 'User' : 'Assistant'}: ${entry.text}\n`;
    }

    console.log(`🤖 Sending to Gemini (${currentModelName}) for user ${userId}`);

    // Gemini API call
    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [{ 
            text: `You are a smart AI assistant. Here is the conversation history:\n${conversationContext}\nAssistant: Please respond to the latest message.` 
          }]
        }
      ]
    });

    const answer = result.response.text();

    user.chatHistory.push({ role: "assistant", text: answer });
    saveDB();

    if (answer.length > 4096) {
      for (let i = 0; i < answer.length; i += 4096) {
        const chunk = answer.substring(i, i + 4096);
        await bot.sendMessage(chatId, chunk);
      }
    } else {
      await bot.sendMessage(chatId, answer);
    }

  } catch (error) {
    console.error("❌ Gemini AI error:", {
      message: error.message,
      status: error.status,
      stack: error.stack
    });
    
    let errorMessage = "⚠️ Sorry, I'm having trouble processing your request. Please try again.";
    
    if (error.message.includes("API key")) {
      errorMessage = "⚠️ Gemini API key is invalid. Please contact the bot administrator.";
    } else if (error.message.includes("quota") || error.message.includes("limit")) {
      errorMessage = "⚠️ Free tier limit reached. Try again later or use /buy to upgrade.";
    } else if (error.message.includes("safety")) {
      errorMessage = "⚠️ I can't respond to that due to safety guidelines.";
    } else if (error.message.includes("not found") || error.message.includes("404")) {
      errorMessage = `⚠️ Model ${currentModelName} not available. Using backup model.`;
      // Try to reinitialize with backup
      await initializeModel();
    }
    
    await bot.sendMessage(chatId, errorMessage);
  }
});

// ================= COMMANDS =================
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  
  const user = getUser(userId);
  const status = user.premium ? "✅ Premium" : "🆓 Free";
  
  await bot.sendMessage(
    chatId,
    "🤖 **Welcome to AI Assistant!**\n\n" +
    `Your status: ${status}\n` +
    `Messages used: ${user.requests || 0}/10 (free users)\n` +
    `AI Model: ${currentModelName}\n\n` +
    "**Commands:**\n" +
    "/buy - Get premium access ($5)\n" +
    "/status - Check your account status\n" +
    "/reset - Reset your chat history\n" +
    "/model - Show current AI model\n\n" +
    "Just send me any message to start chatting! 💬",
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  
  const user = getUser(userId);
  
  await bot.sendMessage(
    chatId,
    "📊 **Your Account Status**\n\n" +
    `Plan: ${user.premium ? "✅ Premium (Unlimited)" : "🆓 Free (10 messages)"}\n` +
    `Messages used: ${user.requests || 0}/10\n` +
    `Chat history: ${(user.chatHistory || []).length} messages\n` +
    `AI Model: ${currentModelName}\n\n` +
    (user.premium ? "🎉 Enjoy unlimited access!" : "💳 Use /buy to upgrade to premium!"),
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/model/, async (msg) => {
  const chatId = msg.chat.id;
  
  await bot.sendMessage(
    chatId,
    `🤖 **Current AI Model**\n\n` +
    `Model: ${currentModelName}\n` +
    `Provider: Google Gemini\n` +
    `Tier: ${currentModelName.includes('pro') ? 'Pro' : 'Flash'}\n` +
    `Best Available: ✅ gemini-3.5-flash\n\n` +
    `To change model, set GEMINI_MODEL in environment variables.\n` +
    `Available: gemini-3.5-flash, gemini-2.5-flash, gemini-2.0-flash`,
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
    "🔄 **Chat history reset!**\n\nStarting fresh conversation.",
    { parse_mode: "Markdown" }
  );
});

// ================= TEST GEMINI ENDPOINT =================
app.get("/test-gemini", async (req, res) => {
  try {
    if (!model) {
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
      apiVersion: "v1beta",
      note: "Using gemini-3.5-flash (best available)"
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      type: error.type || "unknown",
      model: currentModelName,
      suggestion: "Try setting GEMINI_MODEL to 'gemini-3.5-flash'"
    });
  }
});

// ================= LIST AVAILABLE MODELS =================
app.get("/list-models", async (req, res) => {
  try {
    const models = await genAI.listModels();
    const modelNames = models.models.map(m => ({
      name: m.name.replace('models/', ''),
      supportedMethods: m.supportedGenerationMethods || []
    }));
    
    // Filter to only chat models
    const chatModels = modelNames.filter(m => 
      m.name.includes('gemini') && 
      !m.name.includes('embedding') &&
      !m.name.includes('aqa') &&
      m.supportedMethods.includes('generateContent')
    );
    
    // Get top models
    const topModels = chatModels.filter(m => 
      m.name.includes('flash') || m.name.includes('pro')
    );
    
    res.json({
      success: true,
      available_models: topModels.map(m => m.name),
      current_model: currentModelName,
      total_models: models.models.length,
      recommendation: "gemini-3.5-flash (best overall)",
      note: "Use GEMINI_MODEL environment variable to change model"
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      suggestion: "Make sure your API key is valid"
    });
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
    res.json({ 
      message: "Webhook reset successfully",
      note: "Now set a new webhook using /set-webhook endpoint"
    });
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
    status: "✅ Bot is running with Gemini AI",
    version: "7.0.0",
    timestamp: new Date().toISOString(),
    model: currentModelName,
    modelSource: process.env.GEMINI_MODEL ? "Environment Variable" : "Default (gemini-3.5-flash)",
    apiVersion: "v1beta",
    webhook: `${process.env.WEBHOOK_URL}${WEBHOOK_PATH}`,
    endpoints: {
      webhook: WEBHOOK_PATH,
      webhookStatus: "/webhook-status",
      resetWebhook: "/reset-webhook",
      setWebhook: "/set-webhook",
      health: "/health",
      testGemini: "/test-gemini",
      listModels: "/list-models",
      success: "/success",
      cancel: "/cancel"
    }
  });
});

app.get("/health", (req, res) => {
  res.json({ 
    status: "healthy",
    uptime: process.uptime(),
    dbUsers: Object.keys(db.users).length,
    timestamp: new Date().toISOString(),
    ai_provider: "Google Gemini",
    model: currentModelName
  });
});

// ================= START SERVER =================
app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Webhook URL: ${process.env.WEBHOOK_URL}${WEBHOOK_PATH}`);
  console.log(`🤖 AI Provider: Google Gemini`);
  console.log(`📦 Model: ${currentModelName}`);
  console.log(`📋 Test Gemini: https://just-ask-su2i.onrender.com/test-gemini`);
  console.log(`📋 List Models: https://just-ask-su2i.onrender.com/list-models`);
  
  await setWebhook();
  
  console.log(`✅ Bot is ready!`);
  console.log(`👥 Users in DB: ${Object.keys(db.users).length}`);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled Rejection:', error);
});
