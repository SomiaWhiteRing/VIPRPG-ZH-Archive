/** Shared with upload metadata prefill: patch/runtime markers take precedence. */
export function detectSourceEngine(files: readonly { path: string }[]) {
  const paths = new Set(files.map((file) => file.path.toLowerCase()));
  if (paths.has("accord.dll")) return "rpg_maker_2003_maniac";
  if (paths.has("ultimate_rt_eb.dll")) return "rpg_maker_2003";
  return "rpg_maker_2000";
}
