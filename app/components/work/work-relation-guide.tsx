import { Button } from "@/app/components/ui/button";
import * as Dialog from "@/app/components/ui/dialog";
import { InfoTooltip } from "@/app/components/ui/info-tooltip";
import { relationLabel, TRANSLATION_ROLE_LABELS } from "@/lib/labels";
import { X } from "lucide-react";

const descriptions: Record<string, { text: string; example?: string }> = {
  adaptation: {
    text: "两部作品存在明确的改编关系，例如将既有故事改作游戏。单纯移植或更换引擎不自动属于改编。",
  },
  prequel: {
    text: "关联作品讲述当前作品之前的故事，或被明确列为系列前作。",
    example: "在第二部的页面关联第一部，选择“前传”。",
  },
  sequel: {
    text: "关联作品延续当前作品之后的故事，或被明确列为系列后作。",
    example: "在第一部的页面关联第二部，选择“续集”。",
  },
  same_setting: {
    text: "两部作品明确发生在同一个世界或时间线中，但不构成直接的前传、续集关系。角色可以不同，也可以部分重合。",
  },
  alternative_setting: {
    text: "两部作品沿用相同的主要角色，但采用不同的世界、时间线或背景设定。",
  },
  alternative_version: {
    text: "两部作品沿用基本设定和主要角色，对故事、情节或结局作不同演绎。",
  },
  character: {
    text: "两部作品明确沿用同一角色，但故事之间没有连续关系。通常的 VIPRPG 共用角色优先通过“登场角色”记录。",
  },
  collaboration: {
    text: "当前作品明确引入关联作品中的角色或内容。关联对象是联动内容的来源作品；这是一条单向关系。",
    example: "A 引入 B 的角色，在 A 的页面关联 B，选择“联动”。",
  },
  version: {
    text: "关联作品是当前作品的重制、移植或增强版本，主要故事和角色基本相同，画面、音乐或系统有所调整。",
    example: "在最初版本的页面关联重制版，选择“不同版本”。",
  },
  main_version: {
    text: "关联作品是当前重制、移植或增强版本所对应的最初发行版本。",
    example: "在重制版的页面关联最初版本，选择“主版本”。",
  },
  collection: {
    text: "关联作品是实际收录当前作品的合集作品。用户整理的推荐清单、活动列表使用站内目录。",
    example: "在单部作品的页面关联收录它的合集，选择“合集”。",
  },
  in_collection: {
    text: "关联作品是当前合集实际收录的一部作品。",
    example: "在合集的页面关联其中一部作品，选择“收录作品”。",
  },
  original: {
    text: "关联作品是当前译版所依据的原语言作品。原版与译版保持独立条目，双方语言必须不同；一个译版最多关联一个原版。",
    example: "在汉化版的页面关联日语原版，选择“原版”。",
  },
  translation: {
    text: "关联作品是当前作品的其他语言翻译版本。单纯翻译使用翻译关系，不使用“不同版本”或“改编”。",
    example: "在日语原版的页面关联汉化版，选择“译版”。",
  },
};

const groups = [
  { title: "故事与设定", types: ["adaptation", "prequel", "sequel", "same_setting", "alternative_setting", "alternative_version"] },
  { title: "角色关系", types: ["character", "collaboration"] },
  { title: "版本与收录", types: ["version", "main_version", "collection", "in_collection"] },
  { title: "翻译关系", types: ["original", "translation"] },
];

function label(type: string) {
  return type === "original" || type === "translation"
    ? TRANSLATION_ROLE_LABELS[type]
    : relationLabel(type);
}

export function WorkRelationHint({ type }: { type: string }) {
  const description = descriptions[type];
  return (
    <InfoTooltip>
      <div className="space-y-2">
        <p className="m-0 font-semibold">{label(type)}：关联对象之于本作品的关系。</p>
        <p className="m-0">{description.text}</p>
        {description.example ? <p className="m-0 text-muted">{description.example}</p> : null}
      </div>
    </InfoTooltip>
  );
}

export function WorkRelationGuide() {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <Button className="text-secondary" size="sm" type="button" variant="ghost">
          作品关联原则
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content className="left-1/2 top-1/2 grid max-h-[85dvh] w-[min(42rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg">
          <header className="flex items-start gap-3 p-4 sm:p-5">
            <div className="min-w-0 flex-1">
              <Dialog.Title>作品关联原则</Dialog.Title>
              <Dialog.Description className="mb-0 mt-2 text-sm leading-6 text-muted">
                以当前作品为参照，判断关联作品与它的关系。例如，在第二部的页面关联第一部，应选择“前传”。
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button aria-label="关闭关联原则" className="size-8" size="icon" type="button" variant="ghost">
                <X aria-hidden />
              </Button>
            </Dialog.Close>
          </header>
          <div className="min-h-0 space-y-5 overflow-y-auto overscroll-contain px-4 pb-5 sm:px-5">
            <p className="m-0 rounded-md bg-muted/10 px-3 py-2 text-sm leading-6">
              作品关联用于说明两部作品之间明确的故事、设定、版本或收录关系。仅有相同作者、共用素材或通用 VIPRPG 角色，通常不需要建立关联。无法确认时，可以暂不添加。
            </p>
            {groups.map((group) => (
              <section key={group.title}>
                <h3 className="m-0 border-b border-border pb-2 text-sm font-bold text-muted">{group.title}</h3>
                <dl className="m-0 divide-y divide-border">
                  {group.types.map((type) => (
                    <div className="grid gap-1 py-3 sm:grid-cols-[7em_minmax(0,1fr)] sm:gap-4" key={type}>
                      <dt className="text-sm font-semibold">{label(type)}</dt>
                      <dd className="m-0 text-sm leading-6">
                        <p className="m-0">{descriptions[type].text}</p>
                        {descriptions[type].example ? (
                          <p className="mb-0 mt-1 text-xs leading-5 text-muted">{descriptions[type].example}</p>
                        ) : null}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
            <p className="m-0 border-t border-border pt-3 text-xs leading-5 text-muted">
              除“联动”外，系统会自动建立对向关系，无需去另一部作品重复添加。例如，添加“前传”后，对方会显示对应的“续集”。
            </p>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
