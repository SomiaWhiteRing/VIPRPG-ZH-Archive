/** @typedef {{ enabled: boolean, code: string }} RoomPassword */

/** @returns {RoomPassword} */
export function createRoomPassword() {
  const value = crypto.getRandomValues(new Uint32Array(1))[0] % 10000;
  return { enabled: false, code: String(value).padStart(4, "0") };
}

/** @returns {RoomPassword | undefined} */
export function parseRoomPassword(text) {
  if (typeof text !== "string" || text.length > 80) return;
  let value;
  try { value = JSON.parse(text); } catch { return; }
  if (typeof value?.enabled !== "boolean" || typeof value.code !== "string" || !/^\d{4}$/.test(value.code)) return;
  return { enabled: value.enabled, code: value.code };
}

/** @returns {{ code: string | null } | undefined} */
export function parseJoinPassword(text) {
  if (typeof text !== "string" || text.length > 64 || !text.startsWith("room:join:")) return;
  let value;
  try { value = JSON.parse(text.slice(10)); } catch { return; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  if (value.code === undefined || value.code === null) return { code: null };
  if (typeof value.code === "string" && /^\d{4}$/.test(value.code)) return { code: value.code };
}
