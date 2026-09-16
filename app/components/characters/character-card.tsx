import Link from "next/link";
import { Card } from "@/app/components/ui/card";
import { CharacterPortrait } from "@/app/components/ui/character-portrait";
import type { CharacterIndexEntry } from "@/lib/character-index";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/ui/cn";
import { FolderPen, Pencil } from "lucide-react";

export function CharacterCard({ canEdit = false, canEditIndex = false, categoryId, character, displayName, originalName, selected = false, headingLevel = 4, onOpen }: { canEdit?: boolean; canEditIndex?: boolean; categoryId?: string | null; character: Pick<CharacterIndexEntry, "id" | "portrait" | "workCount" | "commentCount" | "materialCount">; displayName: string; originalName: string; selected?: boolean; headingLevel?: 2 | 4; onOpen?: () => void }) {
  const Heading = headingLevel === 2 ? "h2" : "h4";
  return (
    <Card aria-label={displayName} className={cn("relative isolate flex min-w-0 flex-col gap-3 rounded-sm p-3 shadow-none", selected && "border-primary bg-primary/5")}>
      <div className="flex min-w-0 items-start gap-3">
        <CharacterPortrait className={cn("size-12 shrink-0 rounded-sm", !character.portrait && "bg-muted/15 text-muted [text-shadow:none]")} displayName={displayName} portrait={character.portrait} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1.5">
            <Heading className="min-w-0 flex-1 break-words font-semibold leading-snug"><Link className="after:absolute after:inset-0 after:rounded-sm hover:text-primary hover:underline focus-visible:after:ring-2 focus-visible:after:ring-primary/30 md:after:hidden" href={`/characters/${character.id}`} onNavigate={onOpen} prefetch={false}>{displayName}</Link></Heading>
            {canEditIndex ? <Link aria-label={`编辑分类信息 ${displayName}`} className="relative z-10 inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" href={{ pathname: "/admin/characters/index", query: { character: character.id, ...(categoryId ? { category: categoryId } : {}) } }} onNavigate={onOpen} prefetch={false} title="编辑分类信息"><FolderPen aria-hidden size={13} /></Link> : null}
            {canEdit ? <Link aria-label={`编辑角色信息 ${displayName}`} className="relative z-10 inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" href={`/admin/characters/${character.id}`} onNavigate={onOpen} prefetch={false} title="编辑角色信息"><Pencil aria-hidden size={13} /></Link> : null}
          </div>
          <p className="mt-1 break-words text-xs leading-relaxed text-muted" lang="ja">{originalName}</p>
        </div>
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/70 pt-2 text-xs tabular-nums text-muted">
        <span>{formatNumber(character.workCount)} 部作品</span>
        <span>{formatNumber(character.commentCount)} 条评论</span>
        <span>{formatNumber(character.materialCount)} 张素材</span>
      </div>
    </Card>
  );
}
