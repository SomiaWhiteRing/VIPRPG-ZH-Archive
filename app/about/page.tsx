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
          <p className="subtitle">
            项目背景、保存范围、技术架构与边界。
          </p>
        </div>
      </header>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>项目目标</h2>
        <p>
          VIPRPG 中文归档以 VIPRPG 祭典系列（VIPRPG 紅白、VIPRPG 夏の陣等）为中心，
          收录与之相关的 RPG Maker 2000 / 2003 作品，包括原版、汉化版、修正版与活动投稿。
          目标是建立一个可长期检索的中文化资料库：尽可能保留原始文件结构、元数据、
          作者与角色脉络，并提供稳定的下载/在线游玩入口。
        </p>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>资料结构</h2>
        <p>
          每个作品（Work）下挂多个发布版本（Release，例如原版、汉化 v1.0、修正版），
          每个发布版本下挂多个归档快照（ArchiveVersion，对应特定的目录结构与文件集合）。
          下载与在线游玩入口都挂在归档快照层级上，便于追溯具体来源。
        </p>
        <p>
          作者与制作人员、登场角色、标签、系列分别独立索引，可以在
          <Link href="/creators">作者目录</Link>、
          <Link href="/characters">角色目录</Link>、
          <Link href="/tags">标签目录</Link>、
          <Link href="/series">系列目录</Link> 中按任一维度反查作品。
        </p>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>技术架构</h2>
        <p>
          归档运行在 Cloudflare Workers 上，使用 D1 作为元数据数据库、R2 作为对象存储。
          上传走浏览器端预索引：浏览器对本地目录做扫描、SHA-256、core pack 计算，
          再向服务器提交 preflight，只补传缺失的 blob 与 core pack，
          最后在服务端 commit 出 ArchiveVersion。
        </p>
        <p>
          R2 只持久化以下三类对象：
        </p>
        <ul>
          <li>
            <span className="mono">blobs/</span>：去重后的原始文件内容（按 SHA-256）。
          </li>
          <li>
            <span className="mono">core-packs/</span>：常见 RTP/引擎共享文件的整包。
          </li>
          <li>
            <span className="mono">manifests/</span>：归档快照的目录与文件清单。
          </li>
        </ul>
        <p>
          完整游戏 ZIP <strong>不会</strong>常驻 R2；下载请求时由 Workers 流式按
          manifest 重组，并借助 Workers Cache / CDN 边缘缓存命中重复下载。
        </p>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>保存边界</h2>
        <ul>
          <li>仅保存与 VIPRPG 系活动、社区相关的 RPG Maker 2000/2003 作品。</li>
          <li>对原作权利人提出删除/限制要求的内容，会从公开列表移除。</li>
          <li>含 Maniacs Patch 的作品暂不提供在线游玩，仅可下载。</li>
          <li>归档不会篡改原始文件内容；汉化文本以独立 Release 形式并存。</li>
        </ul>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>反馈与贡献</h2>
        <p>
          想要补充作品、纠正资料、或申请成为上传者，可以
          <Link href="/login">登录</Link>
          后在 <Link href="/me">我的账户</Link> 提交申请。
        </p>
      </section>
    </main>
  );
}
