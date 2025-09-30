import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import https from "https";
import { createServer as createHttpServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { v4 as uuidv4 } from "uuid";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
app.set("trust proxy", true);

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "");

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const TOTAL_DAYS = 7;
const SLOTS_PER_DAY = 96;
const TOTAL_SLOTS = TOTAL_DAYS * SLOTS_PER_DAY;

const events = new Map();

const makeEventId = () => uuidv4().slice(0, 8);

const resolveBaseUrl = ({ req, headers, secure } = {}) => {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL;

  if (req) {
    const proto = req.protocol;
    const host = req.headers["x-forwarded-host"] || req.get("host");
    if (host) return `${proto}://${host}`;
  }

  if (headers) {
    const forwardedProto = headers["x-forwarded-proto"]?.split(",")[0]?.trim();
    const hostHeader = headers["x-forwarded-host"] || headers.host;
    if (hostHeader) {
      const proto = forwardedProto || (secure ? "https" : "http");
      return `${proto}://${hostHeader}`;
    }
  }

  return null;
};

const serializeEvent = (event, baseUrl) => {
  const slotTotals = Array(TOTAL_SLOTS).fill(0);
  for (const slotSet of event.slots.values()) {
    for (const slot of slotSet) {
      slotTotals[slot] += 1;
    }
  }
  return {
    id: event.id,
    title: event.title,
    createdAt: event.createdAt,
    participantCount: event.slots.size,
    slotTotals,
    ...(baseUrl ? { shareLink: `${baseUrl}/event/${event.id}` } : {})
  };
};

app.post("/api/events", (req, res) => {
  const title = (req.body?.title || "").trim() || "新的协调事件";
  const id = makeEventId();
  events.set(id, {
    id,
    title,
    createdAt: new Date().toISOString(),
    slots: new Map()
  });
  const proto =
    req.headers["x-forwarded-proto"]?.split(",")[0] ||
    (server instanceof https.Server ? "https" : "http");
  const baseUrl =
    PUBLIC_BASE_URL || `${proto}://${req.headers["x-forwarded-host"] || req.get("host")}`;
  res.status(201).json({
    id,
    title,
    link: `${baseUrl}/event/${id}`
  });
});

app.get("/api/events/:id", (req, res) => {
  const event = events.get(req.params.id);
  if (!event) {
    return res.status(404).json({ error: "事件不存在" });
  }
  const baseUrl =
    resolveBaseUrl({ req }) || `${req.protocol}://${req.get("host")}`;
  res.json(serializeEvent(event, baseUrl));
});

app.get("/event/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "event.html"));
});

const buildServer = () => {
  const keyPath = process.env.SSL_KEY_PATH;
  const certPath = process.env.SSL_CERT_PATH;
  if (keyPath && certPath) {
    try {
      return https.createServer(
        {
          key: readFileSync(keyPath),
          cert: readFileSync(certPath)
        },
        app
      );
    } catch (error) {
      console.error("无法加载 SSL 证书，回退到 HTTP：", error);
    }
  }
  return createHttpServer(app);
};

const server = buildServer();
const io = new SocketIOServer(server);

io.on("connection", (socket) => {
  let joinedEventId = null;

  socket.on("joinEvent", ({ eventId, userId }) => {
    const event = events.get(eventId);
    if (!event) {
      socket.emit("eventError", { message: "事件不存在" });
      return;
    }
    joinedEventId = eventId;
    socket.join(eventId);

    const personalSlots = Array.from(event.slots.get(userId) || []);
    const baseUrl =
      resolveBaseUrl({
        headers: socket.handshake.headers,
        secure: socket.handshake.secure
      }) ||
      `${socket.handshake.secure ? "https" : "http"}://${
        socket.handshake.headers.host
      }`;

    socket.emit("eventState", {
      ...serializeEvent(event, baseUrl),
      yourSlots: personalSlots
    });
  });

  socket.on("updateSlots", ({ eventId, userId, slots }) => {
    if (!eventId || eventId !== joinedEventId) return;
    const event = events.get(eventId);
    if (!event) return;

    const dedupedSlots = new Set(
      (slots || [])
        .map((slot) => Number.parseInt(slot, 10))
        .filter(
          (slot) => Number.isInteger(slot) && slot >= 0 && slot < TOTAL_SLOTS
        )
    );

    event.slots.set(userId, dedupedSlots);

    const state = serializeEvent(event);
    io.to(eventId).emit("eventUpdate", state);
    socket.emit("yourSlots", Array.from(dedupedSlots));
  });

  socket.on("disconnect", () => {
    joinedEventId = null;
  });
});

server.listen(PORT, HOST, () => {
  const proto = server instanceof https.Server ? "https" : "http";
  const displayHost = HOST === "0.0.0.0" ? "0.0.0.0" : HOST;
  console.log(`Server listening on ${proto}://${displayHost}:${PORT}`);
});
