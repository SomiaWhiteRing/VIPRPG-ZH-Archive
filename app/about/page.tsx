import Link from "next/link";

export const dynamic = "force-static";

export const metadata = {
  title: "关于 · VIPRPG 中文归档",
};

export default function AboutPage() {
  return (
    <main>
      <header className="page-header">
        <div>
          <p className="eyebrow">About</p>
          <h1>关于本归档</h1>
        </div>
      </header>

      <section className="card">
        <h2>项目目标</h2>
        <p>
          VIPRPG 中文归档收录 VIPRPG 祭典相关的 RPG Maker 2000/2003 作品，
          包括原版、汉化版、修正版与活动投稿。归档保留原始文件、作品资料、
          作者与角色信息，并提供下载与在线游玩入口。
        </p>
      </section>

      <section className="card">
        <h2>资料结构</h2>
        <p>
          同一作品可收录原版、汉化版与修正版等多个发布版本；每个版本可保留多个归档快照。
          下载与在线游玩入口对应具体快照，便于追溯来源。
        </p>
        <p>
          作者与制作人员、登场角色、标签、系列分别独立索引，可以在
          <Link href="/creators">作者目录</Link>、
          <Link href="/characters">角色目录</Link>、
          <Link href="/tags">标签目录</Link>、
          <Link href="/series">系列目录</Link> 中按任一维度反查作品。
        </p>
      </section>

      <section className="card">
        <h2>技术架构</h2>
        <p>
          网站运行在 Cloudflare Workers 上，D1 保存作品资料，R2 保存游戏文件。
          上传时，浏览器会完成上传前检查，只补传对象存储中缺少的文件；服务器随后完成入库。
        </p>
        <p>
          R2 保存以下三类内容：
        </p>
        <ul>
          <li>
            <span className="mono">原始文件</span>：校验后去重保存的游戏文件。
          </li>
          <li>
            <span className="mono">引擎公共文件</span>：作品共用的 RTP 与引擎文件。
          </li>
          <li>
            <span className="mono">文件清单</span>：每个归档快照的目录与文件记录。
          </li>
        </ul>
        <p>
          完整游戏 ZIP <strong>不会</strong>常驻 R2；下载时由 Workers 根据文件清单流式生成，
          并通过 Workers Cache / CDN 缓存重复请求。
        </p>
      </section>

      <section className="card">
        <h2>保存边界</h2>
        <ul>
          <li>仅保存与 VIPRPG 系活动、社区相关的 RPG Maker 2000/2003 作品。</li>
          <li>对原作权利人提出删除/限制要求的内容，会从公开列表移除。</li>
          <li>使用 Maniacs Patch 的作品暂不支持在线游玩，请下载 ZIP。</li>
          <li>归档不会修改原始文件；汉化版以独立发布版本并存。</li>
        </ul>
      </section>

      <section className="card">
        <h2>反馈与贡献</h2>
        <p>
          补充作品、纠正资料或申请上传权限，可先 <Link href="/login">登录</Link>，
          再前往 <Link href="/me">我的账户</Link>。
        </p>
      </section>
    </main>
  );
}
