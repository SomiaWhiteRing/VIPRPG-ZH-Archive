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

export function validRecordingEvents(seq: unknown, events: unknown, limit: number): events is RecordingBatch["events"];
export function readRecordingGrant(token: string | null, key: string | undefined): Omit<RecordingBatch, "seq" | "events"> | undefined;
export function createMatchRecording(): {
  receive(
    text: string,
    participant: RecordingParticipant,
    players: RecordingParticipant[],
    room: RecordingBatch["room"],
    save: (batch: RecordingBatch) => Promise<unknown>,
    acknowledge: (message: string) => void,
  ): Promise<void> | undefined;
  grant(match: number, participant: RecordingParticipant, players: RecordingParticipant[],
    room: RecordingBatch["room"], signingKey: string): string | undefined;
};
