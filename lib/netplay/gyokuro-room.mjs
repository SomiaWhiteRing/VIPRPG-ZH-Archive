export const roomPath = /^\/api\/netplay\/244\/v1\/(\d{6})$/;

const roster = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 18];
const stages = [6, 5, 7, 8, 11, 9, 12, 1, 14, 15, 13];
const emptyPick = { fighter: 0, serious: 0, ready: 0 };

export class GyokuroRoom {
  #players = [null, null];
  #stage = 6;
  #epoch = 0;
  #playing = false;
  #inputDelay;

  constructor(inputDelay = 2) {
    this.#inputDelay = inputDelay;
  }

  get empty() {
    return !this.#players[0];
  }

  attach(socket, create) {
    const slot = create ? 0 : 1;
    const error = create && this.#players[0] ? "exists"
      : !create && !this.#players[0] ? "missing"
      : this.#players[slot] ? "full" : "";
    if (error) {
      socket.send("E " + error);
      socket.close(1000);
      return null;
    }

    if (create) this.#stage = 6;
    const player = { socket, slot, fighter: 1, serious: 0, ready: 0, next: this.#inputDelay, winner: 0 };
    this.#players[slot] = player;
    socket.send("P " + slot);
    this.#broadcastRoom();

    return {
      message: (text) => this.#receive(player, text),
      close: () => this.#leave(player),
    };
  }

  #broadcastRoom() {
    const [host, guest] = this.#players;
    const picks = [host, guest].map((p) => p ?? emptyPick);
    this.#broadcast(["R", guest ? 1 : 0, this.#stage,
      ...picks.flatMap((p) => [p.fighter, p.serious, p.ready])].join(" "));
  }

  #broadcast(message) {
    for (const player of this.#players) player?.socket.send(message);
  }

  #receive(player, text) {
    if (this.#players[player.slot] !== player) return;
    if (text === "K") {
      player.socket.send("K");
      return;
    }

    if (typeof text !== "string" || text.length > 64 || !/^[AFVICD](?: \d{1,10}){1,3}$/.test(text)) {
      player.socket.close(1008);
      this.#leave(player);
      return;
    }
    const [type, ...words] = text.split(" ");
    const [a, b, c] = words.map(Number);
    const peer = this.#players[1 - player.slot];

    if (this.#playing) {
      if (!peer || a !== this.#epoch) return;
      if (type === "I" && words.length === 3 && b === player.next && c <= 31) {
        player.next++;
        peer.socket.send(text);
      } else if (type === "C" && words.length === 3 && b % 60 === 59 && b < player.next && c <= 0xffffffff) {
        peer.socket.send(text);
      } else if (type === "D" && words.length === 2 && (b === 1 || b === 2)) {
        player.winner = b;
        if (!peer.winner) return;
        if (peer.winner !== b) {
          this.#broadcast("E desync");
          this.#players = [null, null];
          this.#playing = false;
          player.socket.close(1000);
          peer.socket.close(1000);
          return;
        }
        this.#playing = false;
        this.#broadcast("D " + b);
        for (const member of this.#players) member.ready = 0;
        this.#broadcastRoom();
      }
      return;
    }

    if (type === "F" && words.length === 2 && !player.ready &&
        (roster.includes(a) || a === 16) && b <= 1) {
      player.fighter = a;
      player.serious = b;
    } else if (type === "V" && words.length === 1 && !player.ready && player.slot === 0 && stages.includes(a)) {
      this.#stage = a;
    } else if (type === "A" && words.length === 1 && a <= 1) {
      player.ready = a;
    } else {
      return;
    }

    this.#broadcastRoom();
    if (!player.ready || !peer?.ready) return;

    const random = crypto.getRandomValues(new Uint32Array(3));
    const picks = this.#players.flatMap((p, i) => {
      p.next = this.#inputDelay;
      p.winner = 0;
      return [p.fighter === 16 ? roster[random[i] % roster.length] : p.fighter, p.serious];
    });
    this.#playing = true;
    this.#broadcast(["S", ++this.#epoch, random[2], this.#stage, ...picks].join(" "));
  }

  #leave(player) {
    if (this.#players[player.slot] !== player) return;
    this.#players[player.slot] = null;
    this.#playing = false;
    if (player.slot === 0) {
      const guest = this.#players[1];
      this.#players[1] = null;
      guest?.socket.send("L");
      guest?.socket.close(1000);
    } else {
      const host = this.#players[0];
      if (host) {
        host.ready = 0;
        host.socket.send("L");
        this.#broadcastRoom();
      }
    }
  }
}
