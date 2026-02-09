import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getRealtimeSocket() {
  if (typeof window === "undefined") return null;
  if (!socket) {
    socket = io({
      path: "/socket.io",
      transports: ["websocket", "polling"],
    });
  }
  return socket;
}
