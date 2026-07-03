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

const bot = new TelegramBot(process.env.BOT_TOKEN);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ================= DB =================
const DB_FILE = "./db.json";

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ users: {} }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_FILE));
}

let db = loadDB();

function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function getUser(id) {
  if (!db.users[id]) {
    db.users[id] = {
      premium: false,
      requests: 0,
      messages: [
        { role: "system", content: "You are a smart AI assistant." }
      ]
    };
    saveDB();
  }
  return db.users[id];
}

// ================= WEBHOOK =================
const WEBHOOK_PATH = `/bot${process.env.BOT_TOKEN}`;

bot.setWebHook(`${process.env.WEBHOOK_URL}${WEBHOOK_PATH}`);

app.post(WEBHOOK_PATH, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// ================= PAYMENT LINK =================
bot.onText(/\/buy/, async (msg) => {
  const chatId = msg.chat.id;

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: "AI Bot Premium Access",
          },
          unit_amount: 500, // $5
        },
        quantity: 1,
      },
    ],
    success_url: `${process.env.WEBHOOK_URL}/success?user=${msg.from.id}`,
    cancel_url: `${process.env.WEBHOOK_URL}/cancel`,
  });

  bot.sendMessage(chatId, `💳 Pay here to unlock premium:\n${session.url}`);
});

// ================= STRIPE SUCCESS =================
app.get("/success", (req, res) => {
  const userId = req.query.user;

  if (userId) {
    const user = getUser(userId);
    user.premium = true;
    saveDB();
  }

  res.send("✅ Payment successful! You can return to Telegram.");
});

// ================= AI CHAT =================
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!msg.text || msg.text.startsWith("/")) return;

  const user = getUser(userId);

  user.requests++;

  if (!user.premium && user.requests > 10) {
    return bot.sendMessage(
      chatId,
      "🚫 Free limit reached.\n💳 Use /buy to unlock premium."
    );
  }

  user.messages.push({ role: "user", content: msg.text });

  try {
    await bot.sendChatAction(chatId, "typing");

    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: user.messages,
    });

    const answer = res.choices[0].message.content;

    user.messages.push({ role: "assistant", content: answer });

    saveDB();

    bot.sendMessage(chatId, answer);

  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, "⚠️ AI error");
  }
});

app.get("/", (req, res) => {
  res.send("💰 REAL MONEY AI BOT RUNNING");
});

app.listen(PORT, () => {
  console.log("Bot running on port", PORT);
});
