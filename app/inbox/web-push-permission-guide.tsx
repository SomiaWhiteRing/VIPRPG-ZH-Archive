export type PushPermissionGuide = "chrome-desktop" | "chrome-android" | "firefox-desktop" | "firefox-android" | "ios" | "ios-settings" | "other";

const guides = {
  "chrome-desktop": {
    image: "chrome-desktop", alt: "地址栏左侧的站点控件，以及本站通知的允许选项",
    steps: ["点地址栏左侧的站点控件。", "将本站的“通知”改为“允许”。"],
  },
  "chrome-android": {
    image: "chrome-android", alt: "Chrome Android 的本站权限页，以及开启通知的选项",
    steps: ["点地址栏左侧的站点控件 → 权限。", "开启本站的“通知”。"],
  },
  "firefox-desktop": {
    image: "firefox-desktop", alt: "Firefox 页面信息的权限页：取消使用默认，允许发送通知",
    steps: ["站点信息 → 更多信息 → 权限。", "取消“使用默认”，允许“发送通知”。"],
  },
  "firefox-android": {
    image: "firefox-android", alt: "Firefox Android 的网站权限设置：通知改为询问是否允许",
    steps: ["菜单 → 设置 → 网站权限 → 通知。", "改为“询问是否允许”，返回本站重新开启。"],
  },
  ios: {
    image: "ios", alt: "从分享菜单添加到主屏幕，再从主屏幕打开本站",
    steps: ["分享 → 添加到主屏幕。", "从主屏幕打开本站，再开启系统通知。"],
  },
  "ios-settings": {
    image: null, alt: "", steps: ["在系统设置的“通知”中找到本站。", "开启“允许通知”。"],
  },
  other: { image: null, alt: "", steps: ["在浏览器的本站权限中允许通知。"] },
} as const;

export function WebPushPermissionGuide({ guide, supported }: { guide: PushPermissionGuide; supported: boolean }) {
  if (!supported && guide !== "ios") return <p>此环境暂不支持系统通知。</p>;
  const content = guides[guide];
  return <div className="grid gap-3">
    <p className="font-semibold">{guide === "ios" ? "从主屏幕开启通知" : "浏览器阻止了系统通知"}</p>
    {content.image && <img src={`/assets/notification-guide/${content.image}.svg`} alt={content.alt} className="block h-auto w-full" />}
    <ol className="list-decimal space-y-1 pl-5">{content.steps.map(step => <li key={step}>{step}</li>)}</ol>
  </div>;
}
