const byId = (id) => document.getElementById(id);
const status = byId("status");
const rooms = byId("rooms");
const empty = byId("empty");
const create = byId("create");
const match = byId("match");
const leave = byId("leave");
const ready = byId("ready");
const fighter = byId("fighter");
const stage = byId("stage");

const fighters = ["阿格涅法伊亚", "布里扎德", "莱斯帕克", "格林赛", "布莱克拜森", "死之支配者",
  "M·白城", "大和魂", "武藏渔船", "橙子蜜柑", "克里亚克林", "彩虹棒棒糖", "梅塔利卡奇", "黑色雷霆Ⅰ",
  "看板娘", "随机", "天使", "赫尔"];
const stages = [[6, "SCRAPCITY"], [5, "训练场"], [7, "EVENINGROAD"], [8, "COSMO BASE"], [11, "WW2 OBS"],
  [9, "WW1 BRIDGE"], [12, "WW3 UNDERGROUND"], [1, "WH"], [14, "场地 14"], [15, "场地 15"], [13, "场地 13"]];
fighters.forEach((name, index) => fighter.add(new Option(name, index + 1)));
stages.forEach(([id, name]) => stage.add(new Option(name, id)));

const assetBase = "/play/gyokuro-lobby/";
const url = new URL("/api/netplay/244/lobby", window.location.href);
url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
let socket;
let retry;
let player;
let loading;
let roomState;
let gameState;
let slot = -1;
let active = false;
let result = "";

function send(command) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(command);
}

function identityNode(identity) {
  const item = document.createElement("span");
  item.className = "player-identity";
  const avatar = document.createElement("img");
  avatar.src = identity.avatar;
  avatar.alt = "";
  const name = document.createElement("span");
  name.textContent = identity.name;
  item.append(avatar, name);
  return item;
}

function draw() {
  if (!roomState) return;
  const current = roomState.rooms.find((room) => room.id === roomState.roomId);
  byId("identity").replaceChildren(identityNode(roomState.self));
  status.textContent = current
    ? "房间 " + current.id + "　" + current.players.length + "/2" + (result ? "　" + result : "")
    : "已连接";
  create.disabled = match.disabled = Boolean(current);
  leave.hidden = !current;
  byId("room").hidden = !current;
  const picks = gameState?.split(" ").slice(1).map(Number);
  const own = picks && slot >= 0 ? picks.slice(2 + 3 * slot, 5 + 3 * slot) : null;
  if (current) {
    byId("players").replaceChildren(...current.players.map((identity, index) => {
      const row = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = (picks?.[4 + index * 3] ? "已准备" : "未准备");
      row.append(identityNode(identity), label);
      return row;
    }));
    fighter.value = String(own?.[0] ?? 1);
    stage.value = String(picks?.[1] ?? 6);
    byId("stage-choice").hidden = slot !== 0;
    fighter.disabled = stage.disabled = !own || Boolean(own[2]) || active;
    ready.disabled = !own || Boolean(loading) || active;
    ready.textContent = loading ? "加载对战中" : own?.[2] ? "取消准备" : "准备";
  }
  empty.hidden = roomState.rooms.length !== 0;
  rooms.replaceChildren(...roomState.rooms.map((room) => {
    const row = document.createElement("li");
    const detail = document.createElement("div");
    const name = document.createElement("span");
    name.textContent = "房间 " + room.id + "　" + room.players.length + "/2";
    detail.append(name, identityNode(room.players[0]));
    const join = document.createElement("button");
    join.type = "button";
    join.textContent = current?.id === room.id ? "当前房间" : room.playing ? "对战中" : room.players.length === 2 ? "已满" : "加入";
    join.disabled = Boolean(current) || room.players.length === 2;
    join.setAttribute("aria-label", join.textContent + " " + room.id);
    join.addEventListener("click", () => send("join " + room.id));
    row.append(detail, join);
    return row;
  }));
}

function showBattle(value) {
  active = value;
  byId("lobby").hidden = value;
  byId("battle").hidden = !value;
  if (value) byId("canvas").focus();
  else draw();
}

async function preparePlayer() {
  if (player) return;
  const pack = await Promise.all([fetch(assetBase + "game.json"), fetch(assetBase + "game.pack")]);
  if (pack.some((response) => !response.ok)) throw new Error("游戏数据加载失败");
  const [metadata, blob] = await Promise.all([pack[0].json(), pack[1].blob()]);
  player = await window.createEasyRpgPlayer({
    packages: [{ metadata, blob }],
    workId: 244,
    runtimeBase: assetBase + "runtime/",
    arguments: ["--skip-logo", "--engine", "rpg2k3e", "--patch-maniac", "--no-pause-focus-lost"],
    gyokuroSend: send,
    gyokuroView: showBattle,
    onError: (error) => { status.textContent = error.message; },
  });
  if (slot >= 0) player.gyokuroReceive("P " + slot);
  if (gameState) player.gyokuroReceive(gameState);
}

function connect() {
  socket = new WebSocket(url);
  socket.addEventListener("message", ({ data }) => {
    if (data.startsWith("{")) {
      const state = JSON.parse(data);
      if (state.error) {
        status.textContent = state.error;
        return;
      }
      roomState = state;
      draw();
      return;
    }
    if (data.startsWith("P ")) {
      slot = Number(data.slice(2));
      result = "";
    } else if (data.startsWith("R ")) {
      gameState = data;
      draw();
    } else if (data.startsWith("D ")) {
      result = Number(data.slice(2)) === slot + 1 ? "胜利" : "落败";
    } else if (data === "L") {
      result = "";
    }
    player?.gyokuroReceive(data);
  });
  socket.addEventListener("close", () => {
    player?.gyokuroReceive("L");
    roomState = undefined;
    gameState = undefined;
    slot = -1;
    status.textContent = "正在重新连接";
    create.disabled = match.disabled = true;
    leave.hidden = byId("room").hidden = empty.hidden = true;
    rooms.replaceChildren();
    retry = setTimeout(connect, 2000);
  });
}

create.addEventListener("click", () => send("create"));
match.addEventListener("click", () => send("match"));
leave.addEventListener("click", () => send("leave"));
byId("quit").addEventListener("click", () => send("leave"));
fighter.addEventListener("change", () => send("F " + fighter.value + " 0"));
stage.addEventListener("change", () => send("V " + stage.value));
ready.addEventListener("click", async () => {
  if (gameState?.split(" ")[5 + slot * 3] === "1") {
    send("A 0");
    return;
  }
  const room = roomState?.roomId;
  try {
    if (!player) {
      loading = preparePlayer();
      draw();
      await loading;
    }
    if (room && roomState?.roomId === room) send("A 1");
  } catch (error) {
    status.textContent = error.message;
  } finally {
    loading = undefined;
    ready.disabled = !roomState?.roomId;
    ready.textContent = "准备";
  }
});
window.addEventListener("pagehide", () => {
  clearTimeout(retry);
  if (socket) socket.close();
});
connect();
