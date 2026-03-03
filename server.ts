import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import { v4 as uuidv4 } from "uuid";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import Database from "better-sqlite3";
import * as dotenv from "dotenv";
import seedrandom from "seedrandom";
import type { Room, Player, ServerToClientEvents, ClientToServerEvents, LeaderboardEntry } from "./src/types";

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: "*",
  },
});

const PORT = 3000;

// Database Setup
const db = new Database("tombalaliyo.db");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    userId TEXT PRIMARY KEY,
    name TEXT,
    photo TEXT,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0
  )
`);

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", rooms: rooms.size });
});

const rooms: Map<string, Room> = new Map();
const socketToUser: Map<string, string> = new Map(); // socket.id -> userId

// Security: Rate Limiting & Anti-DDoS
const rateLimit: Map<string, { count: number, lastReset: number }> = new Map();
const bannedIPs: Set<string> = new Set();
const IP_LIMIT = 50; // Max requests per 5 seconds
const LIMIT_WINDOW = 5000;

io.use((socket, next) => {
  const ip = socket.handshake.address;
  if (bannedIPs.has(ip)) {
    return next(new Error("IP_BANNED"));
  }
  next();
});

// Gemini Setup
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
  console.warn("WARNING: GEMINI_API_KEY is missing or invalid. AI announcements will be disabled.");
}
const ai = new GoogleGenAI({ apiKey: apiKey || "" });

async function getAIAnnouncement(number: number, room: Room) {
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    return "Sıradaki sayı çekildi!";
  }
  
  const playerStats = room.players.map(p => `${p.name}: ${p.checkedNumbers.length}/15`).join(", ");
  const lastNumbers = room.drawnNumbers.slice(-5).join(", ");
  
  const aiTask = ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Sen TOMBALALIYO isimli bir tombala oyununun punk tarzındaki sunucususun.
    Oyun Durumu:
    - Çekilen sayı: ${number}
    - Önceki sayılar: ${lastNumbers}
    - Oyuncu Durumları: ${playerStats}
    
    Görevin: Kısa, enerjik, punk tarzında, Türkçe bir anons yap (max 15 kelime).`,
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
    }
  });

  // 5 second timeout for AI
  const timeout = new Promise<string>((resolve) => setTimeout(() => resolve(`Sayı ${number}!`), 5000));

  try {
    const result = await Promise.race([aiTask, timeout]);
    if (typeof result === 'string') return result;
    return result.text || `Sayı ${number}!`;
  } catch (error) {
    return `Sayı ${number}!`;
  }
}

function generateBingoCard(seed?: string): number[][] {
  const rng = seed ? seedrandom(seed) : Math.random;
  const card: number[][] = Array.from({ length: 3 }, () => Array(9).fill(0));
  
  const columnPools: number[][] = Array.from({ length: 9 }, (_, i) => {
    const min = i * 10 + 1;
    const max = i === 8 ? 90 : (i + 1) * 10;
    return Array.from({ length: max - min + 1 }, (_, idx) => min + idx);
  });

  const positions: [number, number][] = [];
  const rowCounts = [0, 0, 0];
  const colCounts = Array(9).fill(0);

  // Ensure each column has at least one number
  for (let c = 0; c < 9; c++) {
    const r = Math.floor(rng() * 3);
    positions.push([r, c]);
    rowCounts[r]++;
    colCounts[c]++;
  }

  // Fill up rows to 5 numbers each (total 15)
  while (positions.length < 15) {
    const r = rowCounts.indexOf(Math.min(...rowCounts));
    const availableCols = Array.from({ length: 9 }, (_, i) => i)
      .filter(c => !positions.some(p => p[0] === r && p[1] === c) && colCounts[c] < 3);
    
    if (availableCols.length > 0) {
      const c = availableCols[Math.floor(rng() * availableCols.length)];
      positions.push([r, c]);
      rowCounts[r]++;
      colCounts[c]++;
    } else {
      // Fallback if stuck
      const r2 = Math.floor(rng() * 3);
      const c2 = Math.floor(rng() * 9);
      if (!positions.some(p => p[0] === r2 && p[1] === c2)) {
        positions.push([r2, c2]);
        rowCounts[r2]++;
        colCounts[c2]++;
      }
    }
  }

  // Fill the positions
  positions.forEach(([r, c]) => {
    const pool = columnPools[c];
    const randIdx = Math.floor(rng() * pool.length);
    card[r][c] = pool.splice(randIdx, 1)[0];
  });

  // Sort columns
  for (let c = 0; c < 9; c++) {
    const colNums = card.map(row => row[c]).filter(n => n !== 0).sort((a, b) => a - b);
    let idx = 0;
    for (let r = 0; r < 3; r++) {
      if (card[r][c] !== 0) card[r][c] = colNums[idx++];
    }
  }

  return card;
}

function getLeaderboard(): LeaderboardEntry[] {
  const rows = db.prepare("SELECT * FROM users ORDER BY wins DESC LIMIT 10").all() as any[];
  return rows.map(r => ({
    userId: r.userId,
    name: r.name,
    photo: r.photo,
    wins: r.wins,
    losses: r.losses
  }));
}

io.on("connection", (socket) => {
  const ip = socket.handshake.address;
  console.log("User connected:", socket.id, "IP:", ip);

  // Rate Limiting Middleware for each event
  socket.onAny(() => {
    const now = Date.now();
    const limit = rateLimit.get(socket.id) || { count: 0, lastReset: now };
    
    if (now - limit.lastReset > LIMIT_WINDOW) {
      limit.count = 1;
      limit.lastReset = now;
    } else {
      limit.count++;
    }
    
    rateLimit.set(socket.id, limit);

    if (limit.count > IP_LIMIT) {
      console.warn(`[SECURITY] Rate limit exceeded for ${socket.id} (${ip}). Banning IP.`);
      bannedIPs.add(ip);
      socket.emit("error", "Sistem güvenliği nedeniyle bağlantınız kesildi (DDoS Koruması)");
      socket.disconnect(true);
    }
  });

  socket.on("authenticate", (userId, name, photo) => {
    let user;
    if (userId) {
      user = db.prepare("SELECT * FROM users WHERE userId = ?").get(userId) as any;
    }

    if (!user) {
      const newUserId = userId || Math.floor(100000000000 + Math.random() * 900000000000).toString();
      db.prepare("INSERT INTO users (userId, name, photo) VALUES (?, ?, ?)").run(newUserId, name || "Oyuncu", photo || "");
      user = { userId: newUserId, name: name || "Oyuncu", photo: photo || "", wins: 0, losses: 0 };
    } else if (name || photo) {
      db.prepare("UPDATE users SET name = COALESCE(?, name), photo = COALESCE(?, photo) WHERE userId = ?").run(name, photo, user.userId);
      user = db.prepare("SELECT * FROM users WHERE userId = ?").get(user.userId) as any;
    }

    socketToUser.set(socket.id, user.userId);
    socket.emit("userAuthenticated", user);
    io.emit("leaderboardUpdated", getLeaderboard());
  });

  socket.on("createRoom", (password, serverType) => {
    const userId = socketToUser.get(socket.id);
    if (!userId) return;
    const user = db.prepare("SELECT * FROM users WHERE userId = ?").get(userId) as any;

    const roomId = uuidv4().substring(0, 6).toUpperCase();
    const seed = uuidv4();
    const player: Player = {
      id: socket.id,
      userId: user.userId,
      name: user.name,
      photo: user.photo,
      card: generateBingoCard(`${seed}_${socket.id}`),
      checkedNumbers: [],
      isReady: false,
      score: 0,
      wins: user.wins,
      losses: user.losses,
      isKing: true
    };

    const room: Room = {
      id: roomId,
      password: password || undefined,
      players: [player],
      status: 'waiting',
      drawnNumbers: [],
      currentNumber: null,
      winner: null,
      lastAnnouncement: "Oyuncular bekleniyor...",
      bannedUserIds: [],
      seed: seed,
      serverType: serverType
    };

    rooms.set(roomId, room);
    socket.join(roomId);
    socket.emit("roomUpdated", room);
  });

  socket.on("addBots", (roomId) => {
    const room = rooms.get(roomId.toUpperCase());
    if (!room || room.status !== 'waiting') return;

    const king = room.players.find(p => p.id === socket.id);
    if (!king || !king.isKing) return;

    const botCount = 8 - room.players.length;
    for (let i = 0; i < botCount; i++) {
      const botId = `bot_${uuidv4().substring(0, 8)}`;
      const bot: Player = {
        id: botId,
        userId: botId,
        name: `BOT_${Math.floor(Math.random() * 1000)}`,
        photo: `https://api.dicebear.com/7.x/bottts/svg?seed=${botId}`,
        card: generateBingoCard(`${room.seed}_${botId}`),
        checkedNumbers: [],
        isReady: true,
        score: 0,
        wins: 0,
        losses: 0,
        isKing: false,
        isBot: true
      };
      room.players.push(bot);
    }
    io.to(roomId.toUpperCase()).emit("roomUpdated", room);
  });

  socket.on("leaveRoom", (roomId) => {
    const room = rooms.get(roomId.toUpperCase());
    if (!room) return;

    const index = room.players.findIndex(p => p.id === socket.id);
    if (index !== -1) {
      const wasKing = room.players[index].isKing;
      room.players.splice(index, 1);
      socket.leave(roomId.toUpperCase());
      
      if (room.players.filter(p => !p.isBot).length === 0) {
        rooms.delete(roomId.toUpperCase());
      } else {
        if (wasKing) {
          const nextHuman = room.players.find(p => !p.isBot);
          if (nextHuman) nextHuman.isKing = true;
        }
        io.to(roomId.toUpperCase()).emit("roomUpdated", room);
      }
    }
  });

  socket.on("joinRoom", (roomId, password) => {
    const userId = socketToUser.get(socket.id);
    if (!userId) return;
    const user = db.prepare("SELECT * FROM users WHERE userId = ?").get(userId) as any;

    const room = rooms.get(roomId.toUpperCase());
    if (!room) {
      socket.emit("error", "Oda bulunamadı");
      return;
    }
    if (room.bannedUserIds.includes(userId)) {
      socket.emit("error", "Bu odadan yasaklandınız");
      return;
    }
    if (room.password && room.password !== password) {
      socket.emit("error", "Hatalı şifre");
      return;
    }
    if (room.players.length >= 8) {
      socket.emit("error", "Oda dolu");
      return;
    }
    if (room.status !== 'waiting') {
      socket.emit("error", "Oyun zaten başladı");
      return;
    }

    const player: Player = {
      id: socket.id,
      userId: user.userId,
      name: user.name,
      photo: user.photo,
      card: generateBingoCard(`${room.seed}_${socket.id}`),
      checkedNumbers: [],
      isReady: false,
      score: 0,
      wins: user.wins,
      losses: user.losses,
      isKing: false
    };

    room.players.push(player);
    socket.join(roomId.toUpperCase());
    io.to(roomId.toUpperCase()).emit("roomUpdated", room);
  });

  socket.on("ready", (roomId) => {
    const room = rooms.get(roomId.toUpperCase());
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.isReady = true;
    }

    const allReady = room.players.length >= 2 && room.players.every(p => p.isReady);
    if (allReady) {
      room.status = 'playing';
      io.to(roomId.toUpperCase()).emit("gameStarted", room);
      startGameLoop(roomId.toUpperCase());
    } else {
      io.to(roomId.toUpperCase()).emit("roomUpdated", room);
    }
  });

  socket.on("checkNumber", (roomId, number) => {
    const room = rooms.get(roomId.toUpperCase());
    if (!room || room.status !== 'playing') return;

    // Anti-Cheat: Ensure the number was actually drawn in this room
    if (!room.drawnNumbers.includes(number)) {
      console.warn(`[ANTI-CHEAT] User ${socket.id} tried to check undrawn number ${number}`);
      return;
    }

    const player = room.players.find(p => p.id === socket.id);
    if (player && room.currentNumber === number) {
      if (!player.checkedNumbers.includes(number)) {
        player.checkedNumbers.push(number);
        io.to(roomId.toUpperCase()).emit("roomUpdated", room);
      }
    }
  });

  socket.on("bingo", (roomId) => {
    const room = rooms.get(roomId.toUpperCase());
    if (!room || room.status !== 'playing') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    const cardNumbers = player.card.flat().filter(n => n !== 0);
    
    // Anti-Cheat: Ensure all checked numbers were actually drawn
    const invalidChecks = player.checkedNumbers.filter(n => !room.drawnNumbers.includes(n));
    if (invalidChecks.length > 0) {
      console.warn(`[ANTI-CHEAT] User ${socket.id} has invalid checked numbers: ${invalidChecks}`);
      return;
    }

    const hasBingo = cardNumbers.every(n => player.checkedNumbers.includes(n));

    if (hasBingo) {
      room.status = 'finished';
      room.winner = player;

      db.prepare("UPDATE users SET wins = wins + 1 WHERE userId = ?").run(player.userId);
      room.players.forEach(p => {
        if (p.userId !== player.userId) {
          db.prepare("UPDATE users SET losses = losses + 1 WHERE userId = ?").run(p.userId);
        }
      });

      io.to(roomId.toUpperCase()).emit("gameOver", player);
      io.to(roomId.toUpperCase()).emit("roomUpdated", room);
      io.emit("leaderboardUpdated", getLeaderboard());
    }
  });

  socket.on("kickPlayer", (roomId, targetPlayerId) => {
    const room = rooms.get(roomId.toUpperCase());
    if (!room) return;

    const king = room.players.find(p => p.id === socket.id);
    if (!king || !king.isKing) return;

    const targetPlayer = room.players.find(p => p.id === targetPlayerId);
    if (targetPlayer) {
      room.bannedUserIds.push(targetPlayer.userId);
      room.players = room.players.filter(p => p.id !== targetPlayerId);
      io.to(targetPlayerId).emit("kicked");
      io.to(roomId.toUpperCase()).emit("roomUpdated", room);
    }
  });

  socket.on("sendEmoji", (roomId, targetPlayerId, emoji) => {
    const room = rooms.get(roomId.toUpperCase());
    if (!room) return;

    const sender = room.players.find(p => p.id === socket.id);
    if (!sender) return;

    const target = room.players.find(p => p.id === targetPlayerId);
    if (target) {
      io.to(targetPlayerId).emit("emojiReceived", sender.name, emoji);
    }
  });

  socket.on("getLeaderboard", () => {
    socket.emit("leaderboardUpdated", getLeaderboard());
  });

  socket.on("updateProfile", (name, photo) => {
    const userId = socketToUser.get(socket.id);
    if (!userId) return;

    db.prepare("UPDATE users SET name = ?, photo = ? WHERE userId = ?").run(name, photo, userId);
    
    // Update all rooms where this user is present
    rooms.forEach(room => {
      const player = room.players.find(p => p.userId === userId);
      if (player) {
        player.name = name;
        player.photo = photo;
        io.to(room.id).emit("roomUpdated", room);
      }
    });

    const user = db.prepare("SELECT * FROM users WHERE userId = ?").get(userId) as any;
    socket.emit("userAuthenticated", user);
    io.emit("leaderboardUpdated", getLeaderboard());
  });

  socket.on("disconnect", () => {
    rateLimit.delete(socket.id);
    rooms.forEach((room, roomId) => {
      const index = room.players.findIndex(p => p.id === socket.id);
      if (index !== -1) {
        const wasKing = room.players[index].isKing;
        room.players.splice(index, 1);
        
        if (room.players.length === 0) {
          rooms.delete(roomId);
        } else {
          if (wasKing) {
            room.players[0].isKing = true;
          }
          io.to(roomId).emit("roomUpdated", room);
        }
      }
    });
    socketToUser.delete(socket.id);
  });
});

async function startGameLoop(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;

  // Pre-generate the full shuffle of 1-90 for fairness
  const rng = seedrandom(room.seed);
  const pool = Array.from({ length: 90 }, (_, i) => i + 1);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const runLoop = async () => {
    const currentRoom = rooms.get(roomId);
    if (!currentRoom || currentRoom.status !== 'playing') return;

    if (currentRoom.drawnNumbers.length >= 90) {
      currentRoom.status = 'finished';
      io.to(roomId).emit("roomUpdated", currentRoom);
      return;
    }

    const nextNumber = pool[currentRoom.drawnNumbers.length];

    currentRoom.drawnNumbers.push(nextNumber);
    currentRoom.currentNumber = nextNumber;
    currentRoom.nextNumberAt = Date.now() + 15000;
    currentRoom.isThinking = true;
    currentRoom.lastAnnouncement = "AI Düşünüyor...";
    
    // Emit number immediately so players can see it
    io.to(roomId).emit("numberDrawn", nextNumber, currentRoom.lastAnnouncement);
    io.to(roomId).emit("roomUpdated", currentRoom);
    
    // Fetch AI announcement in background
    getAIAnnouncement(nextNumber, currentRoom).then(announcement => {
      const r = rooms.get(roomId);
      if (r && r.status === 'playing' && r.currentNumber === nextNumber) {
        r.lastAnnouncement = announcement;
        r.isThinking = false;
        io.to(roomId).emit("roomUpdated", r);
      }
    }).catch(() => {
      const r = rooms.get(roomId);
      if (r) r.isThinking = false;
    });

    // Bot actions
    currentRoom.players.filter(p => p.isBot).forEach(bot => {
      const hasNumber = bot.card.flat().includes(nextNumber);
      if (hasNumber) {
        setTimeout(() => {
          const r = rooms.get(roomId);
          if (!r || r.status !== 'playing') return;
          const b = r.players.find(p => p.id === bot.id);
          if (b && !b.checkedNumbers.includes(nextNumber)) {
            b.checkedNumbers.push(nextNumber);
            
            // Check for bot bingo
            const cardNumbers = b.card.flat().filter(n => n !== 0);
            const hasBingo = cardNumbers.every(n => b.checkedNumbers.includes(n));
            if (hasBingo) {
              r.status = 'finished';
              r.winner = b;
              io.to(roomId).emit("gameOver", b);
              io.to(roomId).emit("roomUpdated", r);
              // Update stats for humans
              r.players.forEach(p => {
                if (!p.isBot) {
                  db.prepare("UPDATE users SET losses = losses + 1 WHERE userId = ?").run(p.userId);
                }
              });
              io.emit("leaderboardUpdated", getLeaderboard());
            } else {
              io.to(roomId).emit("roomUpdated", r);
            }
          }
        }, 5000 + Math.random() * 7000);
      }
    });

    // Schedule next draw
    setTimeout(runLoop, 15000);
  };

  runLoop();
}

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`[TOMBALALIYO] Server running on port ${PORT}`);
    console.log(`[TOMBALALIYO] Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

startServer();
