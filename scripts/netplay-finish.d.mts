export function createMatchFinish<Seat>(send: (seat: Seat, text: string) => void): {
  reset(): void;
  restore(seat: Seat): void;
  receive(seat: Seat, peers: Seat[], text: string): void;
};
