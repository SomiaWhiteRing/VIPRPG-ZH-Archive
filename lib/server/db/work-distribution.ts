import { HttpError } from "@/lib/server/http/json";

export const ARCHIVE_ENGINE_FAMILIES = [
  "rpg_maker_2000",
  "rpg_maker_2003",
  "rpg_maker_2003_maniac",
] as const;

export const EXTERNAL_ENGINE_FAMILIES = [
  "rpg_maker_xp",
  "rpg_maker_vx",
  "rpg_maker_vx_ace",
  "rpg_maker_mv",
  "rpg_maker_mz",
  "rpg_maker_unite",
  "mixed",
  "unknown",
  "other",
] as const;

export type WorkDistribution = "archive" | "external" | "invalid";

export function isArchiveEngineFamily(value: string): boolean {
  return (ARCHIVE_ENGINE_FAMILIES as readonly string[]).includes(value);
}

export function isExternalEngineFamily(value: string): boolean {
  return (EXTERNAL_ENGINE_FAMILIES as readonly string[]).includes(value);
}

export function deriveWorkDistribution(input: {
  hasCurrentArchive: boolean;
  downloadLinkCount: number;
}): WorkDistribution {
  if (input.hasCurrentArchive && input.downloadLinkCount === 0) {
    return "archive";
  }
  if (!input.hasCurrentArchive && input.downloadLinkCount === 1) {
    return "external";
  }
  return "invalid";
}

export function assertStableDistribution(input: {
  status: string;
  engineFamily: string;
  hasCurrentArchive: boolean;
  archiveVersionCount?: number;
  downloadLinkCount: number;
}): WorkDistribution {
  if (input.archiveVersionCount && !isArchiveEngineFamily(input.engineFamily)) {
    throw new HttpError(400, "非 RPG Maker 2000/2003 系游戏不能拥有本站归档");
  }

  if (input.status === "processing" || input.status === "deleted") {
    return deriveWorkDistribution(input);
  }

  const distribution = deriveWorkDistribution(input);
  if (distribution === "invalid") {
    throw new HttpError(400, "公开作品必须且只能有一种下载来源");
  }

  if (
    distribution === "external" &&
    !isExternalEngineFamily(input.engineFamily)
  ) {
    throw new HttpError(400, "RPG Maker 2000/2003 系游戏必须使用本站归档");
  }

  if (
    distribution === "archive" &&
    !isArchiveEngineFamily(input.engineFamily)
  ) {
    throw new HttpError(400, "非 RPG Maker 2000/2003 系游戏必须使用外部下载");
  }

  return distribution;
}

export function assertSingleDownloadLink(links: Array<{ linkType: string }>): void {
  const count = links.filter((link) => link.linkType === "download_page").length;
  if (count > 1) {
    throw new HttpError(400, "一个作品只能有一个外部下载地址");
  }
}
