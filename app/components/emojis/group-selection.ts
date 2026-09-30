import { useCallback, useRef, useState } from "react";
import type { EmojiGroup, EmojiLibraryData } from "@/lib/face-emojis";

export function readEmojiGroup(userId: number, groups: EmojiGroup[]): number | null {
  try {
    const value = Number(localStorage.getItem(`viprpg:emoji-group:${userId}`));
    return groups.some((group) => group.id === value) ? value : null;
  } catch { return null; }
}
function rememberEmojiGroup(userId: number, value: number | null) {
  try { localStorage.setItem(`viprpg:emoji-group:${userId}`, String(value ?? "")); } catch { /* Keep the in-memory selection when storage is unavailable. */ }
}
export function useEmojiGroupSelection() {
  const [groupId, setGroupId] = useState<number | null>(null);
  const userId = useRef<number | null>(null);
  const selected = useRef<number | null>(null);
  const selectGroup = useCallback((value: number | null) => {
    selected.current = value;
    setGroupId(value);
    if (userId.current !== null) rememberEmojiGroup(userId.current, value);
  }, []);
  const syncGroups = useCallback((data: EmojiLibraryData, restore = false) => {
    const value = restore || userId.current !== data.userId
      ? readEmojiGroup(data.userId, data.groups)
      : data.groups.some((group) => group.id === selected.current) ? selected.current : null;
    userId.current = data.userId;
    selected.current = value;
    setGroupId(value);
  }, []);
  return { groupId, selectGroup, syncGroups };
}
