export type RecordingParticipant = {
  identity: { name: string };
  account?: { userId: number | null; workId?: number | null; archiveVersionId?: number | null };
};

export type RecordingBatch = {
  id: string;
  match: number;
  startedAt: number;
  participants: { name: string; userId: number | null; workId: number | null; archiveVersionId: number | null }[];
  room: { roomId: number; route?: string; backup?: string; netplaySpaceId?: number; archiveVersionId?: number };
  seat: number;
  seq: number;
  events: [string, ...unknown[]][];
};

export function createMatchRecording(): (
  text: string,
  participant: RecordingParticipant,
  players: RecordingParticipant[],
  room: RecordingBatch["room"],
  save: (batch: RecordingBatch) => Promise<unknown>,
  acknowledge: (message: string) => void,
) => Promise<void> | undefined;
