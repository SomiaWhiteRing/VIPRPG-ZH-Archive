import type { AppRuntime } from "@/app/.server/runtime";
import { fighters, type Scope, type Stats, type StatsRow } from "@/app/special/gyokuro/model";
import { productionGyokuroJapaneseWork, productionNetplayHongKongWork, productionNetplaySiteOrigin, stagingGyokuroWork } from "@/lib/archive/netplay-ingress";

type MatchGroup = {
  first_fighter: number;
  second_fighter: number;
  winning_seat: 1 | 2;
  viewer_seats: 0 | 1 | 2 | 3;
  matches: number;
  latest: number;
};

export async function readGyokuroStats(runtime: AppRuntime, viewerId: number | null, from: number, until: number | null) {
  const production = runtime.origin === productionNetplaySiteOrigin;
  const work = production ? productionNetplayHongKongWork : Number(runtime.env.TOY_NETPLAY_WORK_ID || stagingGyokuroWork);
  const { results } = await runtime.db.prepare(`
    WITH editions AS MATERIALIZED (
      SELECT id FROM public_works WHERE id IN (?1, ?2)
      UNION
      SELECT id FROM works INDEXED BY works_netplay_space_idx
      WHERE status='published' AND audience='public' AND netplay_space_id IN (
        SELECT netplay_space_id FROM public_works WHERE id IN (?1, ?2) AND netplay_space_id IS NOT NULL
      )
    ), matches AS (
      SELECT json_extract(c.start_json, '$.fighters[0]') AS first_fighter,
             json_extract(c.start_json, '$.fighters[1]') AS second_fighter,
             json_extract(c.terminal_json, '$[0]') AS frames,
             json_extract(c.terminal_json, '$[1]') AS first_score,
             json_extract(c.terminal_json, '$[2]') AS second_score,
             (CASE WHEN a.user_id=?3 THEN 1 ELSE 0 END
              + CASE WHEN b.user_id=?3 THEN 2 ELSE 0 END) AS viewer_seats,
             c.started_at
      FROM netplay_replay_catalog c
      JOIN netplay_match_seats a ON a.match_id=c.match_id AND a.seat=1
      JOIN netplay_match_seats b ON b.match_id=c.match_id AND b.seat=2
      WHERE c.started_at>=?4 AND c.started_at<?5
        AND (a.work_id IN editions OR b.work_id IN editions)
        AND NOT EXISTS (
          SELECT 1 FROM netplay_replay_recovery r WHERE r.match_id=c.match_id AND r.variables_json IS NULL
        )
    )
    SELECT first_fighter, second_fighter, CASE WHEN first_score>second_score THEN 1 ELSE 2 END AS winning_seat,
           viewer_seats, COUNT(*) AS matches, MAX(started_at) AS latest
    FROM matches
    WHERE first_fighter IN (${fighters.join(",")}) AND second_fighter IN (${fighters.join(",")})
      AND typeof(frames)='integer' AND frames BETWEEN 1 AND 216000
      AND typeof(first_score)='integer' AND typeof(second_score)='integer'
      AND first_score>=0 AND second_score>=0 AND first_score<>second_score
    GROUP BY first_fighter, second_fighter, winning_seat, viewer_seats
  `).bind(work, production ? productionGyokuroJapaneseWork : work, viewerId, from, until ?? Number.MAX_SAFE_INTEGER).all<MatchGroup>();

  const keys: Scope[] = viewerId === null ? ["all"] : ["all", "mine", "others"];
  const [all, mine, others] = keys.map((key): Stats => {
    const rows = new Map<number, StatsRow>();
    let matches = 0;
    let latest: number | null = null;
    for (const group of results) {
      if ((key === "mine" && !group.viewer_seats) || (key === "others" && group.viewer_seats)) continue;
      matches += group.matches;
      latest = latest === null ? group.latest : Math.max(latest, group.latest);
      for (const seat of [1, 2]) {
        if (key === "mine" && !(group.viewer_seats & seat)) continue;
        const icon = fighters.indexOf(seat === 1 ? group.first_fighter : group.second_fighter);
        const row = rows.get(icon) ?? { icon, count: 0, wins: 0 };
        row.count += group.matches;
        if (seat === group.winning_seat) row.wins += group.matches;
        rows.set(icon, row);
      }
    }
    return { matches, latest, rows: [...rows.values()] };
  });
  return { all, personal: mine && others ? { mine, others } : null };
}
