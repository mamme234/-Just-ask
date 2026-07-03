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
    
    // Test the model with a simple request
    console.log(`🧪 Testing model ${currentModelName}...`);
    const testResult = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: "Say hello" }] }]
    });
    
    const testResponse = testResult.response.text();
    console.log(`✅ Model ${currentModelName} is working! Response: "${testResponse.substring(0, 50)}..."`);
    modelInitialized = true;
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
    
    console.error("❌ No working model found! Please check your API key.");
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
      chatHistory: [],
      totalMessages: 0,
      joinedDate: new Date().toISOString(),
      errors: 0
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
      `💳 **Pay here to unlock premium access:**\n${session.url}\n\n🔒 Only $5 for unlimited access!\n\n✨ **Premium Features:**\n• Unlimited messages\n• Longer responses (8192 tokens)\n• Priority support\n• Advanced AI model: ${currentModelName}`,
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
            "🎉 **Payment successful!** \n\nYou now have premium access. Enjoy unlimited AI chat! 🚀\n\n" +
            `✨ You're now using ${currentModelName} with full features.`,
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
        body { font-family: Arial; text-align: center; padding: 50px; background: #0a0a0a; color: white; }
        .success { color: #4CAF50; font-size: 64px; }
        .card { background: #1a1a1a; padding: 40px; border-radius: 20px; max-width: 500px; margin: 0 auto; }
        h1 { color: #4CAF50; }
        p { color: #aaa; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="success">✅</div>
        <h1>Payment Successful!</h1>
        <p>You can now close this window and return to Telegram.</p>
        <p style="font-size: 14px; margin-top: 20px;">🎉 Welcome to Premium!</p>
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
        body { font-family: Arial; text-align: center; padding: 50px; background: #0a0a0a; color: white; }
        .cancel { color: #f44336; font-size: 64px; }
        .card { background: #1a1a1a; padding: 40px; border-radius: 20px; max-width: 500px; margin: 0 auto; }
        h1 { color: #f44336; }
        p { color: #aaa; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="cancel">❌</div>
        <h1>Payment Cancelled</h1>
        <p>You can try again anytime using /buy in Telegram.</p>
      </div>
    </body>
    </html>
  `);
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
      `✅ **Full response sent (${chunks.length} parts)**\n\n💬 Total: ${text.length} characters`,
      { parse_mode: "Markdown" }
    );
  }
  
  return messages;
}

// ================= AI CHAT WITH FULL RESPONSES =================
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);

  if (!msg.text || msg.text.startsWith("/")) {
    console.log(`⏭️ Skipping command or non-text message from ${userId}`);
    return;
  }

  console.log(`📨 Received message from ${userId}: "${msg.text.substring(0, 100)}${msg.text.length > 100 ? '...' : ''}"`);
  
  try {
    // Check if model is initialized
    if (!modelInitialized) {
      console.log(`🔄 Model not initialized, attempting to reinitialize...`);
      await initializeModel();
      if (!modelInitialized) {
        throw new Error("Model failed to initialize. Please check your API key.");
      }
    }
    
    const user = getUser(userId);
    console.log(`👤 User ${userId} - Premium: ${user.premium}, Requests: ${user.requests}`);

    user.requests = (user.requests || 0) + 1;
    user.totalMessages = (user.totalMessages || 0) + 1;

    const isPremium = user.premium;
    const maxFreeMessages = 10;
    
    if (!isPremium && user.requests > maxFreeMessages) {
      console.log(`🚫 Free limit reached for user ${userId}`);
      await bot.sendMessage(
        chatId,
        "🚫 **Free limit reached!**\n\n" +
        "You've used all 10 free messages.\n" +
        "Use /buy to unlock premium access for only $5! 💰\n\n" +
        "✨ **Premium Benefits:**\n" +
        "• Unlimited messages\n" +
        "• Longer responses (8192 tokens)\n" +
        "• Priority support\n" +
        `• Advanced AI: ${currentModelName}`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    await bot.sendChatAction(chatId, "typing");

    // Store user message
    user.chatHistory = user.chatHistory || [];
    user.chatHistory.push({ role: "user", text: msg.text });

    const maxHistory = isPremium ? 50 : 20;
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
    console.log(`📊 Chat history length: ${user.chatHistory.length} messages`);

    // Prepare prompt
    const systemPrompt = `You are a professional AI assistant. Provide comprehensive, detailed, and well-structured responses. 
    Be helpful, accurate, and thorough in your answers.
    
    Conversation history:
    ${conversationContext}
    
    Assistant: Provide a complete and thorough response to the user's latest message.`;

    console.log(`📝 Prompt length: ${systemPrompt.length} characters`);

    // Gemini API call
    const maxTokens = isPremium ? 8192 : 4096;
    console.log(`🔢 Max tokens: ${maxTokens}`);
    
    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [{ text: systemPrompt }]
        }
      ],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: isPremium ? 0.8 : 0.7,
        topK: 40,
        topP: 0.95,
      }
    });

    console.log(`✅ Received response from Gemini`);

    const fullAnswer = result.response.text();
    console.log(`📝 Response length: ${fullAnswer.length} characters`);

    // Store assistant response
    user.chatHistory.push({ role: "assistant", text: fullAnswer });
    saveDB();

    // Send the full response
    await sendLongMessage(chatId, fullAnswer, { parse_mode: "Markdown" });

  } catch (error) {
    console.error("❌ Gemini AI error:", {
      message: error.message,
      status: error.status,
      code: error.code,
      type: error.type,
      stack: error.stack
    });
    
    // Log full error details
    console.error("🔴 Full error object:", JSON.stringify(error, null, 2));
    
    // Update user error count
    try {
      const user = getUser(userId);
      user.errors = (user.errors || 0) + 1;
      saveDB();
    } catch (e) {
      console.error("❌ Error updating user error count:", e);
    }
    
    // Send appropriate error message
    let errorMessage = "⚠️ Sorry, I'm having trouble processing your request. Please try again.";
    
    if (error.message && error.message.includes("API key")) {
      errorMessage = "⚠️ API key is invalid. Please contact the bot administrator.";
    } else if (error.message && error.message.includes("quota")) {
      errorMessage = "⚠️ API quota exceeded. Please try again later.";
    } else if (error.message && error.message.includes("safety")) {
      errorMessage = "⚠️ I can't respond to that due to safety guidelines.";
    } else if (error.message && error.message.includes("not found")) {
      errorMessage = `⚠️ Model ${currentModelName} not available. Trying backup...`;
      await initializeModel();
    } else if (error.message && error.message.includes("timeout")) {
      errorMessage = "⚠️ Request timed out. Please try with a shorter message.";
    } else if (error.message && error.message.includes("403")) {
      errorMessage = "⚠️ Permission denied. Please check your API key permissions.";
    } else if (error.message && error.message.includes("429")) {
      errorMessage = "⚠️ Too many requests. Please wait a moment and try again.";
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
  const modelInfo = user.premium ? `${currentModelName} (Full)` : `${currentModelName} (Limited)`;
  
  await bot.sendMessage(
    chatId,
    "🤖 **Welcome to Professional AI Assistant!**\n\n" +
    `📊 **Your Status:** ${status}\n` +
    `📝 **Messages Used:** ${user.requests || 0}/${user.premium ? '∞' : '10'}\n` +
    `🤖 **AI Model:** ${modelInfo}\n` +
    `📅 **Joined:** ${new Date(user.joinedDate).toLocaleDateString()}\n\n` +
    "**✨ Features:**\n" +
    "• Full-length responses (up to 8192 tokens)\n" +
    "• Conversation memory\n" +
    "• Code generation\n" +
    "• Professional assistance\n\n" +
    "**📌 Commands:**\n" +
    "/buy - Get premium access ($5)\n" +
    "/status - Check account details\n" +
    "/reset - Clear conversation history\n" +
    "/model - Show current AI model\n" +
    "/help - Show this message again\n\n" +
    "Just send me any message to start chatting! 💬",
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;
  
  await bot.sendMessage(
    chatId,
    "📖 **Help & Commands**\n\n" +
    "**Basic Commands:**\n" +
    "/start - Initialize the bot\n" +
    "/status - Check your account\n" +
    "/reset - Clear chat history\n" +
    "/model - Show AI model info\n" +
    "/help - Show this menu\n\n" +
    "**Premium Commands:**\n" +
    "/buy - Upgrade to premium ($5)\n\n" +
    "**Tips:**\n" +
    "• Free users get 10 messages\n" +
    "• Premium users get unlimited access\n" +
    "• Responses can be very long (8192 tokens)\n" +
    "• Conversation history is saved\n" +
    "• You can ask for code, explanations, and more\n\n" +
    `🤖 **Current Model:** ${currentModelName}\n` +
    `📊 **Model Status:** ${modelInitialized ? '✅ Working' : '❌ Not Initialized'}`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  
  const user = getUser(userId);
  const daysSinceJoin = Math.floor((Date.now() - new Date(user.joinedDate).getTime()) / (1000 * 60 * 60 * 24));
  
  await bot.sendMessage(
    chatId,
    "📊 **Your Account Status**\n\n" +
    `👤 **User ID:** ${userId}\n` +
    `💎 **Plan:** ${user.premium ? "✅ Premium (Unlimited)" : "🆓 Free (10 messages)"}\n` +
    `📝 **Messages Used:** ${user.requests || 0}/${user.premium ? '∞' : '10'}\n` +
    `💬 **Total Messages:** ${user.totalMessages || 0}\n` +
    `📅 **Member For:** ${daysSinceJoin} days\n` +
    `🤖 **AI Model:** ${currentModelName}\n` +
    `⚡ **Response Limit:** ${user.premium ? '8192 tokens' : '4096 tokens'}\n` +
    `⚠️ **Errors:** ${user.errors || 0}\n\n` +
    (user.premium ? "🎉 Enjoy unlimited access!" : "💳 Use /buy to upgrade to premium!"),
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/model/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const user = getUser(userId);
  
  await bot.sendMessage(
    chatId,
    `🤖 **AI Model Information**\n\n` +
    `📦 **Current Model:** ${currentModelName}\n` +
    `🏢 **Provider:** Google Gemini\n` +
    `📊 **Type:** ${currentModelName.includes('pro') ? 'Pro' : 'Flash'}\n` +
    `🔢 **Token Limit:** ${user.premium ? '8192' : '4096'}\n` +
    `💡 **Status:** ${modelInitialized ? '✅ Active' : '❌ Not Initialized'}\n` +
    `💎 **Your Tier:** ${user.premium ? 'Premium' : 'Free'}\n\n` +
    `**Available Models:**\n` +
    `• gemini-3.5-flash (Best)\n` +
    `• gemini-2.5-flash\n` +
    `• gemini-2.0-flash\n\n` +
    `💳 Premium users get full 8192 token responses!`,
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
    "🔄 **Chat history reset!**\n\n" +
    "Starting fresh conversation. Your previous messages are cleared.",
    { parse_mode: "Markdown" }
  );
});

// ================= TEST GEMINI ENDPOINT =================
app.get("/test-gemini", async (req, res) => {
  try {
    if (!modelInitialized) {
      await initializeModel();
    }
    
    if (!modelInitialized) {
      throw new Error("Model not initialized");
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
      modelInitialized: modelInitialized,
      apiVersion: "v1beta",
      status: "✅ Working perfectly",
      features: {
        maxTokens: 8192,
        temperature: 0.7,
        supportsLongResponses: true
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      type: error.type || "unknown",
      model: currentModelName,
      modelInitialized: modelInitialized,
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
    
    const chatModels = modelNames.filter(m => 
      m.name.includes('gemini') && 
      !m.name.includes('embedding') &&
      !m.name.includes('aqa') &&
      m.supportedMethods.includes('generateContent')
    );
    
    res.json({
      success: true,
      available_models: chatModels.map(m => m.name),
      current_model: currentModelName,
      model_initialized: modelInitialized,
      total_models: models.models.length,
      recommendation: "gemini-3.5-flash (best overall)",
      free_tier: {
        messages_per_day: "~1500",
        token_limit: "8192",
        models: ["gemini-3.5-flash", "gemini-2.5-flash", "gemini-2.0-flash"]
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
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
    modelInitialized: modelInitialized,
    modelSource: process.env.GEMINI_MODEL ? "Environment Variable" : "Default",
    features: {
      maxTokens: 8192,
      supportsLongResponses: true,
      autoChunking: true,
      premiumTier: true
    },
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
    model: currentModelName,
    modelInitialized: modelInitialized,
    features: {
      maxTokens: 8192,
      chunking: "auto",
      premium: true
    }
  });
});

// ================= START SERVER =================
app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Webhook URL: ${process.env.WEBHOOK_URL}${WEBHOOK_PATH}`);
  console.log(`🤖 AI Provider: Google Gemini`);
  console.log(`📦 Model: ${currentModelName}`);
  console.log(`📊 Model Initialized: ${modelInitialized}`);
  console.log(`📋 Features: Full Responses (8192 tokens)`);
  console.log(`📋 Test Gemini: https://just-ask-su2i.onrender.com/test-gemini`);
  console.log(`📋 List Models: https://just-ask-su2i.onrender.com/list-models`);
  
  await setWebhook();
  
  console.log(`✅ Bot is ready!`);
  console.log(`👥 Users in DB: ${Object.keys(db.users).length}`);
  console.log(`📝 Long response support: Enabled`);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled Rejection:', error);
});
