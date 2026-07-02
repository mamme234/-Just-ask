import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import fs from "fs";
import OpenAI from "openai";

dotenv.config();

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const DB_FILE = "./db.json";

// ================= DATABASE =================
function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    return { users: {} };
  }
  return JSON.parse(fs.readFileSync(DB_FILE));
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

let db = loadDB();

// ================= USER =================
function getUser(id) {
  if (!db.users[id]) {
    db.users[id] = {
      premium: false,
      messages: [
        {
          role: "system",
          content:
            "You are a smart AI assistant inside a Telegram bot. Be helpful and clear.",
        },
      ],
      requests: 0,
    };
  }
  return db.users[id];
}

// ================= ADMIN CHECK =================
function isAdmin(id) {
  return String(id) === String(process.env.ADMIN_ID);
}

// ================= COMMANDS =================

// start
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "🤖 Welcome to ULTIMATE AI BOT!\n\nSend any question to chat with AI."
  );
});

// reset
bot.onText(/\/reset/, (msg) => {
  const user = getUser(msg.from.id);
  user.messages = user.messages.slice(0, 1);
  saveDB(db);
  bot.sendMessage(msg.chat.id, "♻️ Reset done!");
});

// history
bot.onText(/\/history/, (msg) => {
  const user = getUser(msg.from.id);

  const last = user.messages.slice(-8);
  const text = last.map(m => `${m.role}: ${m.content}`).join("\n\n");

  bot.sendMessage(msg.chat.id, text || "No history");
});

// premium unlock (simple token system)
bot.onText(/\/premium (.+)/, (msg, match) => {
  const user = getUser(msg.from.id);
  const code = match[1];

  if (code === "VIP2026") {
    user.premium = true;
    saveDB(db);
    bot.sendMessage(msg.chat.id, "👑 Premium activated!");
  } else {
    bot.sendMessage(msg.chat.id, "❌ Invalid code");
  }
});

// admin command
bot.onText(/\/users/, (msg) => {
  if (!isAdmin(msg.from.id)) return;

  const count = Object.keys(db.users).length;
  bot.sendMessage(msg.chat.id, `👥 Total users: ${count}`);
});

// ================= MAIN AI CHAT =================
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;

  if (!text || text.startsWith("/")) return;

  const user = getUser(userId);

  user.requests++;
  user.messages.push({ role: "user", content: text });

  try {
    bot.sendChatAction(chatId, "typing");

    // LIMIT FREE USERS (simple monetization)
    if (!user.premium && user.requests > 20) {
      return bot.sendMessage(
        chatId,
        "🚫 Free limit reached.\nUse /premium VIP2026 to unlock unlimited access."
      );
    }

    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: user.messages,
    });

    const answer = res.choices[0].message.content;

    user.messages.push({ role: "assistant", content: answer });

    saveDB(db);

    bot.sendMessage(chatId, answer);
  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, "⚠️ Error occurred. Try again later.");
  }
});
