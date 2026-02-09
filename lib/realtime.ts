type RealtimeEvent = "lesson:update";

type RealtimePayload = {
  lessonId?: string;
  sessionId?: string;
  source?: string;
};

export function emitRealtime(event: RealtimeEvent, payload: RealtimePayload) {
  const io = (globalThis as any).__io as
    | import("socket.io").Server
    | undefined;
  if (!io) return;

  const rooms: string[] = [];
  if (payload.lessonId) rooms.push(`lesson:${payload.lessonId}`);
  if (payload.sessionId) rooms.push(`session:${payload.sessionId}`);

  if (rooms.length) {
    rooms.forEach((room) => io.to(room).emit(event, payload));
    return;
  }
  io.emit(event, payload);
}
