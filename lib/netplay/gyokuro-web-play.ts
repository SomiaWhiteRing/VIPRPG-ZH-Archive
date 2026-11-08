export const gyokuroStagingOrigin = "https://staging.viprpg.org";
export const gyokuroWorkTitle = "玉露弾・联机版";
export const gyokuroEndpoint = "/api/netplay/244/lobby-v3";
export const gyokuroRuntime = "/play/gyokuro-lobby/runtime-v6";

export function gyokuroWebPlayOptions(origin: string, originalTitle: string) {
  if (origin !== gyokuroStagingOrigin || originalTitle !== gyokuroWorkTitle) return {};
  return { gyokuroEndpoint, runtimeBasePath: gyokuroRuntime, runtimeAssetBasePath: gyokuroRuntime };
}
