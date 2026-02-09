import http from "http";
import next from "next";
import { Server as SocketIOServer } from "socket.io";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3000", 10);
const app = next({ dev });
const handle = app.getRequestHandler();

await app.prepare();

const server = http.createServer((req, res) => {
  handle(req, res);
});

const io = new SocketIOServer(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

globalThis.__io = io;

io.on("connection", (socket) => {
  socket.on("join", ({ lessonId, sessionId } = {}) => {
    if (lessonId) socket.join(`lesson:${lessonId}`);
    if (sessionId) socket.join(`session:${sessionId}`);
  });
});

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`> Server listening on http://localhost:${port}`);
});
