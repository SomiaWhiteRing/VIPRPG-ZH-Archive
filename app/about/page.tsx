import Link from "next/link";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";

export const dynamic = "force-static";

export const metadata = {
  title: "关于 · VIPRPG.org",
};

export default function AboutPage() {
  return (
    <main>
      <PageHeader title="关于本站" />

      <Pane heading="项目目标">
        <p>
          VIPRPG.org 收录 VIPRPG 祭典相关的 RPG Maker 作品，
          包括不同语言和本站原创作品；2000/2003 系游戏提供本站归档，其他引擎提供外部下载入口。
        </p>
      </Pane>

      <Pane heading="资料与索引">
        <p>每个游戏有独立资料页。本站归档的作品公开当前可下载版本，历史版本仅供管理和校对；翻译关系和其他关联连接不同游戏。</p>
        <p>
          作者与制作人员、登场角色、标签、目录分别独立索引，可以在
          <Link href="/creators">作者目录</Link>、<Link href="/characters">角色目录</Link>、
          <Link href="/tags">标签目录</Link>、<Link href="/catalogs">目录</Link> 中按任一维度反查游戏。
        </p>
      </Pane>

      <Pane heading="归档与下载">
        <p>
          上传 RPG Maker 2000/2003 游戏时，浏览器会先检查文件，只上传本站尚未保存的内容。
          文件按内容去重保存；下载时再按该版本的文件清单生成完整 ZIP，并缓存重复下载。
        </p>
        <p>
          在线游玩会把所需内容安装到当前浏览器的本地存储。删除本地游戏缓存不会同时删除 EasyRPG 存档。
        </p>
      </Pane>

      <Pane heading="保存边界">
        <ul>
          <li>仅保存与 VIPRPG 系活动、社区相关的 RPG Maker 作品。</li>
          <li>对原作权利人提出删除/限制要求的内容，会从公开列表移除。</li>
          <li>使用 RPG Maker 2003 Maniac 的作品可能无法用 EasyRPG 正常游玩。</li>
          <li>本站不会修改原始文件；不同语言的作品以独立游戏条目保存，并通过翻译关联连接。</li>
        </ul>
      </Pane>

      <Pane heading="反馈与贡献">
        <p>
          补充作品、纠正资料或申请上传权限，可先 <Link href="/login">登录</Link>， 再前往{" "}
          <Link href="/me">我的账户</Link>。
        </p>
      </Pane>
    </main>
  );
}
