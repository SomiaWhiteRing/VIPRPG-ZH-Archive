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
          VIPRPG.org收录 VIPRPG 祭典相关的 RPG Maker 2000/2003 作品，
          包括不同语言和本站原创作品。本站保留游戏资料、作者与角色信息，并提供下载与在线游玩入口。
        </p>
      </Pane>

      <Pane heading="资料结构">
        <p>每次上传对应一个游戏和一个不可变归档快照；同一游戏的历史快照只在管理端保留，翻译关系和其他关联在上传后追加。</p>
        <p>
          作者与制作人员、登场角色、标签、目录分别独立索引，可以在
          <Link href="/creators">作者目录</Link>、<Link href="/characters">角色目录</Link>、
          <Link href="/tags">标签目录</Link>、<Link href="/catalogs">目录</Link> 中按任一维度反查游戏。
        </p>
      </Pane>

      <Pane heading="技术架构">
        <p>
          网站运行在 Cloudflare Workers 上，D1 保存作品资料，R2 保存游戏文件。
          上传时，浏览器会完成上传前检查，只补传对象存储中缺少的文件；服务器随后完成入库。
        </p>
        <p>R2 保存以下三类内容：</p>
        <ul>
          <li>
            <span className="font-mono text-sm text-primary">原始文件</span>
            ：校验后去重保存的游戏文件。
          </li>
          <li>
            <span className="font-mono text-sm text-primary">引擎公共文件</span>
            ：作品共用的 RTP 与引擎文件。
          </li>
          <li>
            <span className="font-mono text-sm text-primary">文件清单</span>
            ：每个可下载版本的目录与文件记录。
          </li>
        </ul>
        <p>
          完整游戏 ZIP <strong>不会</strong>常驻 R2；下载时由 Workers 根据文件清单流式生成， 并通过 Workers Cache / CDN
          缓存重复请求。
        </p>
      </Pane>

      <Pane heading="保存边界">
        <ul>
          <li>仅保存与 VIPRPG 系活动、社区相关的 RPG Maker 2000/2003 作品。</li>
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
