import http from "http";
import { WebSocketServer } from "ws";
import fs from "fs";
import path from "path";

const PORT = process.env.PORT || 8080;

// Fallback küçük liste (words.txt yoksa)
const WORDS = [
  "kalem",
  "bilgisayar",
  "istanbul",
  "merhaba",
  "mendix",
  "javascript",
  "websocket",
  "bahar",
  "bulut",
  "papatya",
  "mutluluk",
  "renkli",
  "oyun",
  "hızlı",
  "klavye",
  "react",
  "node",
  "kavun",
  "portakal",
  "şeker",
];

// === Seçenek 2: Büyük kelime listesi ===
const WORD_MIN = Number(process.env.WORD_MIN_LEN || 4);
const WORD_MAX = Number(process.env.WORD_MAX_LEN || 12);

let BIG_WORDS = [];
function loadWordsFile() {
  try {
    // index.js ile aynı klasörde words.txt bekliyoruz
    const filePath = path.resolve(process.cwd(), "words.txt");
    const raw = fs.readFileSync(filePath, "utf8");

    const list = raw
      .split(/\r?\n/)
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean)
      // sadece a-z (istersen sonra Türkçe karakter de ekleriz)
      .filter((w) => /^[a-z]+$/.test(w))
      .filter((w) => w.length >= WORD_MIN && w.length <= WORD_MAX);

    BIG_WORDS = Array.from(new Set(list)); // duplicate temizle
    console.log(
      `[words] loaded ${BIG_WORDS.length} words from words.txt (${WORD_MIN}-${WORD_MAX} chars)`,
    );
  } catch (e) {
    BIG_WORDS = [];
    console.log("[words] words.txt okunamadı. Fallback WORDS kullanılacak.");
  }
}
loadWordsFile();

// rooms: Map<roomCode, Room>
const rooms = new Map();

/**
 * Room shape:
 * {
 *   code: string,
 *   players: Map<playerId, {
 *     id, name, score, joinedAt, ws,
 *     isReadyForNext: boolean,
 *     votedNextWord: boolean
 *   }>,
 *   currentWord: string,
 *   roundId: number,
 *   roundOpen: boolean,
 *   roundWinnerId: string|null,
 *   createdAt: number
 * }
 */

function randWord(except) {
  const source = BIG_WORDS.length > 0 ? BIG_WORDS : WORDS;
  if (source.length === 0) return "word";

  let w = source[Math.floor(Math.random() * source.length)];
  if (except && source.length > 1) {
    while (w === except) w = source[Math.floor(Math.random() * source.length)];
  }
  return w;
}

const now = () => Date.now();

function getOrCreateRoom(code) {
  if (!rooms.has(code)) {
    rooms.set(code, {
      code,
      players: new Map(),
      currentWord: randWord(),
      roundId: 1,
      roundOpen: false,
      roundWinnerId: null,
      createdAt: now(),
    });
  }
  return rooms.get(code);
}

function roomSnapshot(room) {
  const players = Array.from(room.players.values())
    .map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      isReadyForNext: p.isReadyForNext,
      votedNextWord: !!p.votedNextWord,
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  const allReady =
    players.length > 0 && players.every((p) => p.isReadyForNext === true);

  const allVotedNextWord =
    players.length > 0 && players.every((p) => p.votedNextWord === true);

  return {
    code: room.code,
    players,
    currentWord: room.currentWord,
    roundId: room.roundId,
    roundOpen: room.roundOpen,
    roundWinnerId: room.roundWinnerId,
    allReady,
    allVotedNextWord,
  };
}

function broadcastRoom(room) {
  const payload = JSON.stringify({
    type: "ROOM_STATE",
    data: roomSnapshot(room),
  });
  for (const p of room.players.values()) {
    if (p.ws.readyState === 1) p.ws.send(payload);
  }
}

function safeSend(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function startNewRound(room) {
  room.roundId += 1;
  room.currentWord = randWord(room.currentWord);
  room.roundOpen = true;
  room.roundWinnerId = null;

  for (const p of room.players.values()) {
    p.isReadyForNext = false;
    p.votedNextWord = false;
  }
  broadcastRoom(room);
}

function maybeOpenRound(room) {
  const snap = roomSnapshot(room);
  if (snap.allReady) startNewRound(room);
  else broadcastRoom(room);
}

function handleCorrect(room, playerId) {
  if (!room.roundOpen) return;
  if (room.roundWinnerId) return;

  const player = room.players.get(playerId);
  if (!player) return;

  player.score += 1;
  room.roundWinnerId = playerId;
  room.roundOpen = false;

  // Round bitti -> yeni round için herkes tekrar hazır/vote bassın
  for (const p of room.players.values()) {
    p.votedNextWord = false;
    p.isReadyForNext = false;
  }

  broadcastRoom(room);
}

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }
  // words.txt yüklendi mi görmek için debug endpoint
  if (req.url === "/wordsinfo") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        bigWordsCount: BIG_WORDS.length,
        min: WORD_MIN,
        max: WORD_MAX,
      }),
    );
    return;
  }
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Typing Race WS Server");
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  let roomCode = null;
  let playerId = null;

  safeSend(ws, { type: "WS_READY" });

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      safeSend(ws, { type: "ERROR", message: "Invalid JSON" });
      return;
    }

    const { type, data } = msg || {};

    if (type === "JOIN") {
      const code = String(data?.roomCode || "")
        .trim()
        .toUpperCase();
      const name = String(data?.name || "")
        .trim()
        .slice(0, 20);

      if (!code || !name) {
        safeSend(ws, { type: "ERROR", message: "roomCode ve name zorunlu" });
        return;
      }

      const room = getOrCreateRoom(code);

      playerId = `p_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
      roomCode = code;

      room.players.set(playerId, {
        id: playerId,
        name,
        score: 0,
        joinedAt: now(),
        ws,
        isReadyForNext: false,
        votedNextWord: false,
      });

      safeSend(ws, { type: "JOINED", data: { playerId, roomCode } });
      broadcastRoom(room);
      return;
    }

    if (!roomCode || !playerId) {
      safeSend(ws, { type: "ERROR", message: "Önce JOIN yapmalısın" });
      return;
    }

    const room = rooms.get(roomCode);
    if (!room) {
      safeSend(ws, { type: "ERROR", message: "Room bulunamadı" });
      return;
    }

    // READY sadece "Hazırım"
    if (type === "SET_READY_NEXT") {
      const p = room.players.get(playerId);
      if (!p) return;

      if (p.isReadyForNext === true) return; // idempotent
      p.isReadyForNext = true;

      if (!room.roundOpen) maybeOpenRound(room);
      else broadcastRoom(room);
      return;
    }

    // Kelime güncelle sadece vote/kelime
    if (type === "REQUEST_NEXT_WORD") {
      const p = room.players.get(playerId);
      if (!p) return;

      if (room.roundOpen) {
        broadcastRoom(room);
        return;
      }

      if (p.votedNextWord === true) return; // idempotent
      p.votedNextWord = true;

      const snap = roomSnapshot(room);
      if (snap.allVotedNextWord) {
        room.currentWord = randWord(room.currentWord);
        for (const x of room.players.values()) x.votedNextWord = false;
      }

      broadcastRoom(room);
      return;
    }

    if (type === "SUBMIT_TYPED") {
      const typed = String(data?.typed || "");
      const roundId = Number(data?.roundId);

      if (roundId !== room.roundId) return;
      if (!room.roundOpen) return;

      if (typed.trim() === room.currentWord) handleCorrect(room, playerId);
      return;
    }

    if (type === "LEAVE") {
      room.players.delete(playerId);
      if (room.players.size === 0) rooms.delete(roomCode);
      else broadcastRoom(room);

      roomCode = null;
      playerId = null;
      return;
    }
  });

  ws.on("close", () => {
    if (!roomCode || !playerId) return;
    const room = rooms.get(roomCode);
    if (!room) return;

    room.players.delete(playerId);
    if (room.players.size === 0) rooms.delete(roomCode);
    else broadcastRoom(room);
  });
});

server.listen(PORT, () => {
  console.log(`WS server running on http://localhost:${PORT}`);
});
