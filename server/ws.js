import { WebSocketServer } from "ws";
import { verifyToken } from "./auth.js";

/** Connected clients: ws -> { userId, email } */
const clients = new Map();

export function setupWebSocket(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url, "http://localhost");
    const token = url.searchParams.get("token");
    const payload = token ? verifyToken(token) : null;

    if (!payload) {
      ws.close(4001, "Unauthorized");
      return;
    }

    clients.set(ws, { userId: payload.id, email: payload.email });

    ws.on("close", () => clients.delete(ws));
    ws.on("error", () => clients.delete(ws));

    // Heartbeat so dead connections get cleaned up.
    ws.isAlive = true;
    ws.on("pong", () => {
      ws.isAlive = true;
    });
  });

  const interval = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);

  wss.on("close", () => clearInterval(interval));

  return wss;
}

/** Broadcast an event to every connected authenticated client. */
export function broadcast(type, data) {
  const payload = JSON.stringify({ type, data });
  for (const [ws] of clients) {
    if (ws.readyState === ws.OPEN) {
      ws.send(payload);
    }
  }
}
