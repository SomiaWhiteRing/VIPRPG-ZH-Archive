import { Badge } from "@/app/components/ui/badge";
import { WorkListRow } from "@/app/components/work/work-list-row";
import { CHARACTER_ROLE_LABELS } from "@/lib/character-names";
import type {
  CharacterWork,
  CharacterWorkCredit,
} from "@/lib/dto/db/character-detail";

export function CharacterWorkList({
  works,
  characterName,
  standalone = false,
}: {
  works: CharacterWork[];
  characterName: string;
  standalone?: boolean;
}) {
  return (
    <ul className={`m-0 list-none divide-y divide-border p-0 ${standalone ? "border-b border-border" : ""}`}>
      {works.map((work) => (
        <li key={work.id}>
          <WorkListRow
            href={`/games/${work.id}`}
            title={work.title}
            originalTitle={work.originalTitle}
            coverBlobSha256={work.coverBlobSha256}
            authorName={work.authorName}
            releaseDate={work.releaseDate}
            engineFamily={work.engineFamily}
            language={work.language}
          >
            {work.credits.map((credit) =>
              credit.spoilerLevel > 0 ? (
                <details className="mt-1.5 text-sm" key={credit.creditId}>
                  <summary className="cursor-pointer text-muted">
                    登场信息（含剧透）
                  </summary>
                  <CharacterCredit work={credit} characterName={characterName} />
                </details>
              ) : (
                <CharacterCredit key={credit.creditId} work={credit} characterName={characterName} />
              ),
            )}
          </WorkListRow>
        </li>
      ))}
    </ul>
  );
}

function CharacterCredit({ work, characterName }: {
  work: CharacterWorkCredit;
  characterName: string;
}) {
  return (
    <div className="mt-1.5 text-sm">
      <Badge variant="credit">{CHARACTER_ROLE_LABELS[work.roleKey]}</Badge>
      {work.displayName !== characterName ? (
        <span className="ml-2 text-muted">{work.displayName}</span>
      ) : null}
      {work.notes ? (
        <p className="m-0 mt-1 text-muted wrap-anywhere">{work.notes}</p>
      ) : null}
    </div>
  );
}
