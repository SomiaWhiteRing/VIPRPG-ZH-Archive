import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { PageContainer } from "@/app/components/ui/page-container";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import type { MetaFunction } from "react-router";
import { Link } from "react-router";

export const dynamic = "force-static";

export const meta: MetaFunction = ({ error }) =>
  pageMetaDescriptors({ title: "关于本站" }, error);

export default function AboutPage() {
  return (
    <PageContainer className="space-y-5">
      <PageHeader compact title="关于本站" />

      <Pane heading="这里是哪里？">
        <p>
          VIPRPG中文保管库，或者说VIPRPG.org（以下称作“本站”），是由中文VIPRPG爱好者开发、面向华语社区的作品保存库。<br/>
          本站点<span className="line-through">因为懒得折腾备案</span>自豪地使用Cloudflare提供的网络服务！<br/>
          大概在大陆是能用吧，不能用的区域就请各凭本事了……
        </p>
      </Pane>

      <Pane heading="这里能做什么？">
        <p>
          身为保管库，本站理所当然的提供RPG Maker 2000系作品的存档与下载。<br/>
          无论是汉化作品、原创作品、还是原版作品的保存，甚至是记录VIPRPG以外的RM2K作品，本站都非常欢迎。
        </p>
        <p>
          除此之外，本站还提供了许多<span className="line-through">老实说多到莫名其妙</span>的功能。<br/>
          不仅可以在作品上标记登场角色、作者、标签等信息，还留下了评论、收藏和目录系统，来方便管理和检索作品；<br/>
          提供了作品的在线游玩，以及（在Android设备上）导入到EasyRPG的功能。<br/>
          另外还做了收集各种链接的导航页，再加上老实说完全没想过有没有人会用的讨论版……<br/>
          之类的请自行探索相关功能吧！（忘了自己都做过什么）
        </p>
      </Pane>

      <Pane heading="这里是如何存储作品的？">
        <p>
          在VIPRPG的世界里，作品的素材有着极高的重合度。同一张シバルバー的黑市脸图可能会在1000个ksg里出现500次。<br/>
          针对这种现象，本站设计了一套让不同作品共享相同素材的存储系统。<br/>
          地图、游戏数据库等核心文件会被打包保存，脸图、音乐等素材则按内容去重：<br/>
          内容相同的素材只保存一份，可以理解成站点自己的“RTP”。<br/>
          下载作品时，再根据每部作品的文件清单取回所需内容，重新打包成ZIP。<br/>
        </p>
        <p>
          通过这一设计，本站得以大幅降低每部作品的存储占用。<br/>
          相对的缺点也很明显——无法存储RPGMaker2000系以外的作品。<br/>
          为此，本站提供了外链机制。可以使用自己的网盘来提交2K系以外的作品。<br/>
          推荐使用<Link to="https://www.lanzou.com/">蓝奏云</Link>，<Link to="https://mega.nz/">MEGA</Link>或<Link to="https://drive.google.com/">Google Drive</Link>来提交外链。<br/>
        </p>
        <p>
          追加：随着站点运行，该系统的另一个问题也浮现出来：<br/>
          非VIPRPG作品如果存在着巨量的非共享素材，就会占用本站昂贵的对象存储空间。<br/>
          为此，本站会不定期的视非共享素材使用量清理非VIPRPG作品的归档，并在清理前不会给出任何说明。<br/>
          如果您有收录作品的需求，请使用不会给本站带来负担的外链功能。<br/>
        </p>
      </Pane>

      <Pane heading="鸣谢">
        <p>
          本站的设计参考了H5mota，Bangumi，Mastodon，Ticalc，Bilibili，百度贴吧，NGA国家地理等项目的优秀实现。<br/>
          本站的开发使用了EasyRPG项目的开发者们创造的出色Web Player与liblcf库。<br/>
          本站的创建离不开中文社区与本土的每一位VIPRPG爱好者。
        </p>
      </Pane>
    </PageContainer>
  );
}
