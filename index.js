import express from "express";
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import fs from "fs";
import OpenAI from "openai";
import Stripe from "stripe";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ================= VALIDATE ENV VARIABLES =================
const requiredEnv = ['BOT_TOKEN', 'OPENAI_API_KEY', 'STRIPE_SECRET_KEY', 'WEBHOOK_URL'];
for (const env of requiredEnv) {
  if (!process.env[env]) {
    console.error(`❌ Missing required environment variable: ${env}`);
    process.exit(1);
  }
}

// ================= INITIALIZE SERVICES =================
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: false });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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
      messages: [
        { role: "system", content: "You are a smart AI assistant." }
      ]
    };
    saveDB();
  }
  return db.users[userId];
}

// ================= WEBHOOK =================
const WEBHOOK_PATH = `/webhook/${process.env.BOT_TOKEN}`;

// Set webhook with retry logic
async function setWebhook() {
  try {
    const webhookUrl = `${process.env.WEBHOOK_URL}${WEBHOOK_PATH}`;
    console.log(`🔄 Setting webhook to: ${webhookUrl}`);
    
    // Remove any existing webhook first
    await bot.setWebHook('', { drop_pending_updates: true });
    
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

// Webhook endpoint - handle both GET and POST
app.all(WEBHOOK_PATH, async (req, res) => {
  try {
    // For GET requests - show webhook info
    if (req.method === 'GET') {
      const webhookInfo = await bot.getWebHookInfo();
      return res.json({
        status: "✅ Webhook endpoint is active",
        webhook_info: webhookInfo,
        method: "GET (testing)",
        note: "Send POST requests for bot updates"
      });
    }
    
    // For POST requests - process Telegram updates
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
              description: "Unlimited AI chat access"
            },
            unit_amount: 500, // $5.00
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
      // Verify the payment was successful
      if (sessionId) {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (session.payment_status === 'paid') {
          const user = getUser(userId);
          user.premium = true;
          user.requests = 0; // Reset requests on upgrade
          saveDB();
          
          // Notify user in Telegram
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

// ================= AI CHAT =================
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);

  // Ignore non-text messages and commands
  if (!msg.text || msg.text.startsWith("/")) return;

  try {
    const user = getUser(userId);

    // Increment request count
    user.requests = (user.requests || 0) + 1;

    // Check premium status and limits
    if (!user.premium && user.requests > 10) {
      await bot.sendMessage(
        chatId,
        "🚫 **Free limit reached!**\n\n" +
        "You've used all 10 free messages.\n" +
        "Use /buy to unlock premium access for only $5! 💰\n\n" +
        "✨ Premium benefits:\n" +
        "• Unlimited messages\n" +
        "• Priority response\n" +
        "• Access to GPT-4o-mini",
        { parse_mode: "Markdown" }
      );
      return;
    }

    // Add user message to history
    user.messages.push({ role: "user", content: msg.text });

    // Keep conversation history manageable (last 20 messages)
    if (user.messages.length > 21) {
      user.messages = user.messages.slice(0, 1).concat(user.messages.slice(-20));
    }

    await bot.sendChatAction(chatId, "typing");

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: user.messages,
      max_tokens: 1000,
      temperature: 0.7,
    });

    const answer = response.choices[0].message.content;

    // Add assistant response to history
    user.messages.push({ role: "assistant", content: answer });

    saveDB();

    // Send response in chunks if too long (Telegram limit: 4096 chars)
    if (answer.length > 4096) {
      for (let i = 0; i < answer.length; i += 4096) {
        const chunk = answer.substring(i, i + 4096);
        await bot.sendMessage(chatId, chunk);
      }
    } else {
      await bot.sendMessage(chatId, answer);
    }

  } catch (error) {
    console.error("❌ AI error:", error);
    await bot.sendMessage(chatId, "⚠️ Sorry, I'm having trouble processing your request. Please try again.");
  }
});

// ================= START COMMAND =================
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  
  const user = getUser(userId);
  const status = user.premium ? "✅ Premium" : "🆓 Free";
  
  await bot.sendMessage(
    chatId,
    "🤖 **Welcome to AI Assistant!**\n\n" +
    `Your status: ${status}\n` +
    `Messages used: ${user.requests || 0}/10 (free users)\n\n` +
    "**Commands:**\n" +
    "/buy - Get premium access ($5)\n" +
    "/status - Check your account status\n" +
    "/reset - Reset your chat history\n\n" +
    "Just send me any message to start chatting! 💬",
    { parse_mode: "Markdown" }
  );
});

// ================= STATUS COMMAND =================
bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  
  const user = getUser(userId);
  
  await bot.sendMessage(
    chatId,
    "📊 **Your Account Status**\n\n" +
    `Plan: ${user.premium ? "✅ Premium (Unlimited)" : "🆓 Free (10 messages)"}\n` +
    `Messages used: ${user.requests || 0}/10\n` +
    `Chat history: ${(user.messages.length - 1)} messages\n\n` +
    (user.premium ? "🎉 Enjoy unlimited access!" : "💳 Use /buy to upgrade to premium!"),
    { parse_mode: "Markdown" }
  );
});

// ================= RESET COMMAND =================
bot.onText(/\/reset/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  
  const user = getUser(userId);
  user.messages = [
    { role: "system", content: "You are a smart AI assistant." }
  ];
  user.requests = user.premium ? 0 : 0;
  saveDB();
  
  await bot.sendMessage(
    chatId,
    "🔄 **Chat history reset!**\n\nStarting fresh conversation.",
    { parse_mode: "Markdown" }
  );
});

// ================= WEBHOOK STATUS =================
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

// ================= RESET WEBHOOK =================
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
    const webhookUrl = `${process.env.WEBHOOK_URL}${WEBHOOK_PATH}`;
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
    status: "✅ Bot is running",
    version: "7.0.0",
    timestamp: new Date().toISOString(),
    webhook: `${process.env.WEBHOOK_URL}${WEBHOOK_PATH}`,
    endpoints: {
      webhook: WEBHOOK_PATH,
      webhookStatus: "/webhook-status",
      resetWebhook: "/reset-webhook",
      setWebhook: "/set-webhook",
      health: "/health",
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
    timestamp: new Date().toISOString()
  });
});

// ================= START SERVER =================
app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Webhook URL: ${process.env.WEBHOOK_URL}${WEBHOOK_PATH}`);
  
  // Set webhook
  await setWebhook();
  
  console.log(`✅ Bot is ready!`);
  console.log(`👥 Users in DB: ${Object.keys(db.users).length}`);
  console.log(`\n📋 Available endpoints:`);
  console.log(`   GET  / - Health check`);
  console.log(`   GET  ${WEBHOOK_PATH} - Webhook status`);
  console.log(`   GET  /webhook-status - Webhook info`);
  console.log(`   GET  /reset-webhook - Reset webhook`);
  console.log(`   GET  /set-webhook - Set webhook`);
  console.log(`   POST ${WEBHOOK_PATH} - Telegram webhook endpoint`);
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled Rejection:', error);
});
