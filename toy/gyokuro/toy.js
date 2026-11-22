import config from "./config.js";

const frame = document.querySelector("iframe");
const controls = document.querySelector("#controls");
const credentialKey = "gyokuro-netplay-v1";
const api = new URL("/api/toy/gyokuro-netplay", config.siteOrigin);
let player;

async function readBilibiliProfile(sdk) {
  const { nickname, avatar } = await sdk.getUserProfile();
  const face = new URL(avatar);
  const portrait = await fetch(`https://p0.hdslb.com${face.pathname}@192w_192h_1c.png`, { credentials: "omit" });
  if (!portrait.ok) throw new Error(`Bilibili avatar request failed (${portrait.status})`);
  const picture = new Uint8Array(await portrait.arrayBuffer());
  let binary = "";
  for (let index = 0; index < picture.length; index += 8192) {
    binary += String.fromCharCode(...picture.subarray(index, index + 8192));
  }
  return { nickname, avatarPng: btoa(binary) };
}

async function readToyCredential(sdk) {
  const saved = await sdk.getCloudStorage([credentialKey]);
  if (saved[credentialKey] !== undefined) return saved[credentialKey];
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  await sdk.setCloudStorage({ [credentialKey]: token });
  return token;
}

async function launch() {
  const sdk = window.toy;
  const profile = readBilibiliProfile(sdk).catch(() => undefined);
  const credential = readToyCredential(sdk).catch(() => undefined);
  sdk?.setContainerMode?.({ orientation: "landscape", immersive: true }).catch(() => {});
  const frameReady = frame.contentWindow?.createEasyRpgPlayer ? undefined
    : new Promise(resolve => frame.addEventListener("load", resolve, { once: true }));
  const session = Promise.all([profile, credential]).then(async ([identity, token]) => {
    const response = await fetch(api, {
      method: "POST", credentials: "omit",
      headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) },
      body: JSON.stringify({ operation: "session", archiveVersionId: config.archiveVersionId, ...identity }),
    });
    if (!response.ok) throw new Error(`Toy session failed (${response.status})`);
    return { ...await response.json(), token };
  });
  const [startup, game] = await Promise.all([session, fetch(new URL("./game.data", import.meta.url)), frameReady]);
  if (!game.ok) throw new Error(`Toy archive failed (${game.status})`);
  const packages = [{ blob: await game.blob(), metadata: config.game }];
  const view = frame.contentWindow;
  if (!view?.createEasyRpgPlayer) throw new Error("Toy player frame is not ready");
  frame.hidden = false;
  controls.hidden = false;
  player = await view.createEasyRpgPlayer({
    workId: startup.workId,
    netplayEndpoint: startup.netplayEndpoint,
    runtimeBase: "./runtime/",
    storage: {
      module: new URL("./runtime/toy-storage.js", import.meta.url).href,
      data: { packages, endpoint: api.href, token: startup.token },
    },
    arguments: config.arguments,
    gameServices: "toy-replays.js",
    onError: console.error,
    onExit: () => location.reload(),
  });
  frame.contentDocument.querySelector("canvas").focus();
}

void launch().catch(console.error);

for (const button of controls.querySelectorAll("button")) {
  const code = button.dataset.key;
  const active = new Set();
  const send = pressed => {
    const view = frame.contentWindow;
    frame.contentDocument.querySelector("canvas").dispatchEvent(new view.KeyboardEvent(
      pressed ? "keydown" : "keyup", { code, bubbles: true, cancelable: true },
    ));
  };
  button.addEventListener("pointerdown", event => {
    if (!player) return;
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    if (!active.size) send(true);
    active.add(event.pointerId);
  });
  button.addEventListener("lostpointercapture", event => {
    if (active.delete(event.pointerId) && !active.size) send(false);
  });
}
