import { Button } from "@/app/components/ui/button";
import { ShowcaseImage } from "@/app/components/profile/showcase-image";
import {
  SHOWCASE_LABELS,
  showcaseHref,
  type ShowcaseEntry,
  type ShowcaseKind,
} from "@/lib/showcase";
import { ChevronDown } from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router";


const showcaseToggleClassName = "flex w-full min-h-0 items-center justify-between gap-1.5 p-0 text-left text-[11px] leading-[1.6] font-bold tracking-[0.6px] whitespace-normal text-primary [&_svg]:size-[15px] [@container(max-width:620px)]:col-start-2 [@container(max-width:620px)]:row-start-1 pointer-coarse:min-h-[27px]";

export function Showcase({
  entries,
  editable = false,
}: {
  entries: ShowcaseEntry[];
  editable?: boolean;
}) {
  const visible = entries.filter((entry) => entry.target !== null);
  const expandable = visible.filter((entry) => entry.note.trim());
  const switchable = expandable.length > 1;
  const [selected, setSelected] = useState<ShowcaseKind | undefined>(
    expandable[0]?.kind,
  );
  const active = expandable.some((entry) => entry.kind === selected)
    ? selected
    : expandable[0]?.kind;
  const buttons = useRef<
    Partial<Record<ShowcaseKind, HTMLButtonElement | null>>
  >({});
  const pointer = useRef({ x: -1, y: -1 });
  const id = useId();
  if (!visible.length) return null;

  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (
      ![
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
      ].includes(event.key)
    )
      return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? expandable.length - 1
          : (index +
              (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1) +
              expandable.length) %
            expandable.length;
    setSelected(expandable[next].kind);
    buttons.current[expandable[next].kind]?.focus();
  }

  return (
    <section className="@container [--showcase-duration:420ms] [--showcase-easing:cubic-bezier(0.22,0.7,0.25,1)] [--showcase-image-height:157px] motion-reduce:[--showcase-duration:0ms]" aria-labelledby={`${id}-title`}>
      <header className="mb-[13px] flex items-center justify-between gap-3">
        <h2 className="m-0 text-lg font-bold" id={`${id}-title`}>
          喜爱展柜
        </h2>
        {editable ? (
          <Link
            className="text-[13px] font-normal leading-[1.6] text-primary hover:underline"
            to="/me/showcase"
          >
            编辑展柜
          </Link>
        ) : null}
      </header>
      <div className="flex items-stretch gap-2.5 [@container(max-width:620px)]:grid [@container(max-width:620px)]:gap-[9px]">
        {visible.map((entry) => {
          const target = entry.target!;
          const canExpand = !!entry.note.trim();
          const expanded = active === entry.kind;
          const label = `最喜欢的${SHOWCASE_LABELS[entry.kind]}`;
          return (
            <article
              className="group/showcase min-w-0 flex-[1_1_0] rounded-lg border border-border bg-card p-4 [transition:flex-grow_var(--showcase-duration)_var(--showcase-easing),background-color_var(--showcase-duration),border-color_var(--showcase-duration)] data-[expanded=true]:grow-[3.1] data-[highlighted=true]:bg-[color-mix(in_srgb,var(--color-rm2k-green-1)_8%,var(--color-card))] data-[highlighted=true]:border-[color-mix(in_srgb,var(--color-rm2k-green-1)_48%,var(--color-border))] [@container(620px<width<=760px)]:p-[13px] [@container(max-width:620px)]:p-[13px] [@container(max-width:620px)]:grid [@container(max-width:620px)]:grid-cols-[74px_minmax(0,1fr)] [@container(max-width:620px)]:grid-rows-[27px_minmax(36px,auto)_0fr] [@container(max-width:620px)]:gap-x-[13px] [@container(max-width:620px)]:[transition:grid-template-rows_var(--showcase-duration)_var(--showcase-easing),background-color_var(--showcase-duration)] [@container(max-width:620px)]:data-[expanded=true]:grid-rows-[27px_minmax(36px,auto)_1fr]"
              data-expanded={expanded}
              data-highlighted={expanded && switchable}
              data-kind={entry.kind}
              key={entry.kind}
              onPointerMove={(event) => {
                // Pointer movement, rather than enter events, prevents moving card edges from switching back.
                if (
                  !switchable ||
                  !canExpand ||
                  event.pointerType !== "mouse" ||
                  !window.matchMedia("(hover: hover)").matches
                )
                  return;
                if (
                  pointer.current.x === event.clientX &&
                  pointer.current.y === event.clientY
                )
                  return;
                pointer.current = { x: event.clientX, y: event.clientY };
                setSelected(entry.kind);
              }}
              onClick={(event) => {
                if (
                  !switchable ||
                  !canExpand ||
                  (event.target as Element).closest("a,button")
                )
                  return;
                setSelected(entry.kind);
              }}
            >
              {canExpand && switchable ? (
                <Button
                  className={`${showcaseToggleClassName} hover:bg-transparent`}
                  type="button"
                  variant="ghost"
                  ref={(node) => {
                    buttons.current[entry.kind] = node;
                  }}
                  aria-expanded={expanded}
                  aria-controls={`${id}-${entry.kind}`}
                  aria-label={`展开最喜欢的${SHOWCASE_LABELS[entry.kind]}：${target.name}的附言`}
                  onClick={() => setSelected(entry.kind)}
                  onKeyDown={(event) =>
                    navigate(
                      event,
                      expandable.findIndex((item) => item.kind === entry.kind),
                    )
                  }
                >
                  {label}
                  <ChevronDown aria-hidden="true" className="[transform:rotate(-90deg)] transition-transform duration-(--showcase-duration) ease-[ease] group-data-[expanded=true]/showcase:[transform:rotate(0)]" />
                </Button>
              ) : (
                <div className={showcaseToggleClassName}>{label}</div>
              )}
              <h3 className="mt-[5px] mb-[13px] text-[17px] leading-[1.6] font-bold [overflow-wrap:anywhere] [&_a:hover]:underline [&_a:hover]:underline-offset-4 [@container(620px<width<=760px)]:text-base [@container(max-width:620px)]:col-start-2 [@container(max-width:620px)]:row-start-2 [@container(max-width:620px)]:mt-0.5 [@container(max-width:620px)]:mb-0 [@container(max-width:620px)]:text-[17px] [@container(max-width:620px)]:self-start pointer-coarse:[&_a]:inline-block pointer-coarse:[&_a]:pb-2.5">
                <Link to={showcaseHref(target)}>{target.name}</Link>
              </h3>
              <div className="flex min-w-0 items-start [@container(max-width:620px)]:contents">
                <Link
                  className="flex h-(--showcase-image-height) min-w-0 flex-[0_0_100%] justify-start overflow-hidden [transition:flex-basis_var(--showcase-duration)_var(--showcase-easing)] group-data-[expanded=true]/showcase:basis-(--showcase-image-height) group-[[data-kind=work][data-expanded=true]]/showcase:basis-[calc(var(--showcase-image-height)*4/3)] [@container(max-width:620px)]:col-start-1 [@container(max-width:620px)]:row-[1/3] [@container(max-width:620px)]:w-[74px] [@container(max-width:620px)]:h-[63px] [@container(max-width:620px)]:max-w-none"
                  to={showcaseHref(target)}
                  aria-label={`查看${target.name}的详情`}
                >
                  <ShowcaseImage target={target} />
                </Link>
                {canExpand ? (
                  <div
                    className="ml-0 grid min-w-0 flex-[0_1_0] grid-rows-[0fr] opacity-0 [transform:translateX(12px)] [transition:grid-template-rows_var(--showcase-duration),flex-grow_var(--showcase-duration)_var(--showcase-easing),margin-left_var(--showcase-duration),opacity_180ms,transform_var(--showcase-duration)] group-data-[expanded=true]/showcase:grid-rows-[1fr] group-data-[expanded=true]/showcase:grow group-data-[expanded=true]/showcase:opacity-100 group-data-[expanded=true]/showcase:ml-[18px] group-data-[expanded=true]/showcase:[transform:translateX(0)] [@container(620px<width<=760px)]:group-data-[expanded=true]/showcase:ml-[13px] [@container(max-width:620px)]:col-[1/3] [@container(max-width:620px)]:row-start-3 [@container(max-width:620px)]:min-h-0 [@container(max-width:620px)]:grid-rows-[1fr] [@container(max-width:620px)]:[transform:translateY(6px)] [@container(max-width:620px)]:group-data-[expanded=true]/showcase:m-0 [@container(max-width:620px)]:group-data-[expanded=true]/showcase:[transform:translateY(0)] motion-reduce:transition-none"
                    id={`${id}-${entry.kind}`}
                    aria-hidden={!expanded}
                    inert={!expanded}
                  >
                    <div className="min-h-0 min-w-0 overflow-hidden">
                      <div
                        className="min-w-[140px] max-h-(--showcase-image-height) overflow-y-auto [scrollbar-width:thin] [@container(620px<width<=760px)]:min-w-[115px] [@container(max-width:620px)]:min-w-0 [@container(max-width:620px)]:pt-[15px]"
                        tabIndex={expanded ? 0 : -1}
                      >
                        <p className="m-0 font-['Segoe_UI','Microsoft_YaHei',sans-serif] text-base leading-[1.9] font-normal tracking-normal whitespace-pre-wrap [overflow-wrap:anywhere] [@container(max-width:620px)]:border-t [@container(max-width:620px)]:border-border [@container(max-width:620px)]:pt-3">{entry.note}</p>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
