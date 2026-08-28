import Image from "next/image";
import { Rm2kButton } from "@/app/components/ui/rm2k-button";

export function HomeAnchors() {
  return (
    <nav className="my-6 flex flex-nowrap justify-center gap-2" aria-label="首页内容导航">
      <Rm2kButton href="#recent-updates" icon={<AnchorIcon />} size="large">
        最近更新
      </Rm2kButton>
      <Rm2kButton href="#recent-original" icon={<AnchorIcon />} size="large">
        最近原创
      </Rm2kButton>
      <Rm2kButton href="#about-site" icon={<AnchorIcon />} size="large">
        关于本站
      </Rm2kButton>
    </nav>
  );
}

function AnchorIcon() {
  return (
    <span className="grid size-7 shrink-0 place-items-center overflow-hidden sm:size-14">
      <Image alt="" aria-hidden className="size-6 sm:size-13" height={52} src="/icon/windI.png" width={52} />
    </span>
  );
}
