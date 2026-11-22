import config from "./config.js";

const frame = document.querySelector("iframe");
const start = document.querySelector("#start");
const controls = document.querySelector("#controls");
const credentialKey = "gyokuro-netplay-v1";
const api = new URL("/api/toy/gyokuro-netplay", config.siteOrigin);
let player;

start.addEventListener("click", async () => {
  start.disabled = true;
  try {
    const sdk = window.toy;
    // Request App container changes from the same gesture that starts the game.
    const orientation = sdk.setContainerMode?.({ orientation: "landscape", immersive: true });
    orientation?.catch(() => {});
    const { nickname, avatar } = await sdk.getUserProfile();
    const saved = await sdk.getCloudStorage([credentialKey]);
    let token = saved[credentialKey];
    if (token === undefined) {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      await sdk.setCloudStorage({ [credentialKey]: token });
    }

    const [session, game] = await Promise.all([
      fetch(api, {
        method: "POST", credentials: "omit",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ operation: "session", archiveVersionId: config.archiveVersionId, nickname, avatar }),
      }),
      fetch(new URL("./game.data", import.meta.url)),
    ]);
    if (!session.ok || !game.ok) throw new Error(`Toy startup failed (${session.status}, ${game.status})`);
    const { workId, netplayEndpoint } = await session.json();
    const packages = [{ blob: await game.blob(), metadata: config.game }];
    const view = frame.contentWindow;
    if (!view?.createEasyRpgPlayer) throw new Error("Toy player frame is not ready");

    start.hidden = true;
    frame.hidden = false;
    controls.hidden = false;
    player = await view.createEasyRpgPlayer({
      workId,
      netplayEndpoint,
      runtimeBase: "./runtime/",
      storage: {
        module: new URL("./runtime/toy-storage.js", import.meta.url).href,
        data: { packages, endpoint: api.href, token },
      },
      arguments: config.arguments,
      gameServices: "toy-replays.js",
      onError: console.error,
      onExit: () => location.reload(),
    });
    frame.contentDocument.querySelector("canvas").focus();
  } catch (error) {
    console.error(error);
    controls.hidden = true;
    frame.hidden = true;
    start.hidden = false;
    // The canvas may already belong to the engine Worker.
    frame.src = new URL("./player.html", import.meta.url).href;
  } finally {
    start.disabled = false;
  }
});

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
