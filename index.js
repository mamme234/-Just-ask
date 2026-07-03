import express from "express";
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import fs from "fs";
import OpenAI from "openai";

dotenv.config();

// =======================
// EXPRESS SERVER (Render)
// =======================
const app = express();

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("🤖 Ultimate Telegram AI Bot is running!");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// =======================
// TELEGRAM BOT
// =======================
const bot = new TelegramBot(process.env.BOT_TOKEN, {
  polling: true,
});

// =======================
// OPENAI
// =======================
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// =======================
// DATABASE
// =======================
const DB_FILE = "./db.json";

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(
      DB_FILE,
      JSON.stringify(
        {
          users: {},
        },
        null,
        2
      )
    );
  }

  return JSON.parse(fs.readFileSync(DB_FILE));
}

let db = loadDB();

function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// =======================
// USER DATA
// =======================
function getUser(id) {
  if (!db.users[id]) {
    db.users[id] = {
      premium: false,
      requests: 0,
      messages: [
        {
          role: "system",
          content:
            "You are a professional AI assistant. Give accurate, helpful, and concise answers.",
        },
      ],
    };

    saveDB();
  }

  return db.users[id];
}

// =======================
// ADMIN CHECK
// =======================
function isAdmin(id) {
  return String(id) === String(process.env.ADMIN_ID);
          }// =======================
// COMMANDS
// =======================

// START
bot.onText(/^\/start$/, (msg) => {
  getUser(msg.from.id);

  bot.sendMessage(
    msg.chat.id,
`🤖 *Ultimate AI Bot*

Welcome!

Send me any question and I'll answer it.

Commands:
/help
/reset
/history`,
    { parse_mode: "Markdown" }
  );
});

// HELP
bot.onText(/^\/help$/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
`📚 *Help*

/start - Start bot
/help - Show help
/reset - Clear conversation
/history - Show recent history

Simply send a message to chat with AI.`,
    { parse_mode: "Markdown" }
  );
});

// RESET
bot.onText(/^\/reset$/, (msg) => {
  const user = getUser(msg.from.id);

  user.messages = [
    {
      role: "system",
      content:
        "You are a professional AI assistant. Give accurate, helpful and concise answers."
    }
  ];

  saveDB();

  bot.sendMessage(msg.chat.id, "✅ Conversation memory cleared.");
});

// HISTORY
bot.onText(/^\/history$/, (msg) => {
  const user = getUser(msg.from.id);

  const history = user.messages
    .filter(m => m.role !== "system")
    .slice(-10);

  if (!history.length) {
    return bot.sendMessage(msg.chat.id, "No history yet.");
  }

  const text = history
    .map(m => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");

  bot.sendMessage(msg.chat.id, text.substring(0, 4000));
});

// PREMIUM
bot.onText(/^\/premium (.+)/, (msg, match) => {

  const code = match[1];

  if (code !== "VIP2026") {
    return bot.sendMessage(msg.chat.id, "❌ Invalid premium code.");
  }

  const user = getUser(msg.from.id);

  user.premium = true;

  saveDB();

  bot.sendMessage(msg.chat.id, "👑 Premium activated successfully!");
});

// ADMIN USERS
bot.onText(/^\/users$/, (msg) => {

  if (!isAdmin(msg.from.id)) return;

  const total = Object.keys(db.users).length;

  bot.sendMessage(
    msg.chat.id,
    `👥 Total users: ${total}`
  );
});

// BROADCAST
bot.onText(/^\/broadcast (.+)/, async (msg, match) => {

  if (!isAdmin(msg.from.id)) return;

  const message = match[1];

  const users = Object.keys(db.users);

  let sent = 0;

  for (const id of users) {

    try {

      await bot.sendMessage(id, message);

      sent++;

    } catch {}

  }

  bot.sendMessage(
    msg.chat.id,
    `✅ Broadcast sent to ${sent} users.`
  );

});// =======================
// AI CHAT
// =======================

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!msg.text) return;
  if (msg.text.startsWith("/")) return;

  const user = getUser(userId);

  // Free limit
  if (!user.premium && user.requests >= 20) {
    return bot.sendMessage(
      chatId,
      "🚫 You have reached your free limit.\nUse /premium YOUR_CODE to unlock unlimited access."
    );
  }

  user.requests++;

  user.messages.push({
    role: "user",
    content: msg.text
  });

  // Keep only the last 20 conversation messages (+ system prompt)
  if (user.messages.length > 21) {
    user.messages = [
      user.messages[0],
      ...user.messages.slice(-20)
    ];
  }

  saveDB();

  try {
    await bot.sendChatAction(chatId, "typing");

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: user.messages,
    });

    const answer =
      response.choices?.[0]?.message?.content ||
      "Sorry, I couldn't generate a response.";

    user.messages.push({
      role: "assistant",
      content: answer,
    });

    saveDB();

    await bot.sendMessage(chatId, answer, {
      disable_web_page_preview: true,
    });

  } catch (err) {
    console.error(err);

    await bot.sendMessage(
      chatId,
      "⚠️ An error occurred while contacting the AI service."
    );
  }
});

// =======================
// STARTUP
// =======================

console.log("================================");
console.log(" Ultimate Telegram AI Bot");
console.log(" Bot Started Successfully");
console.log("================================");
