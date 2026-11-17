import { useMessages } from "@/lib/i18n/react";

export type PushPermissionGuide = "chrome-desktop" | "chrome-android" | "firefox-desktop" | "firefox-android" | "ios" | "ios-settings" | "other";

const guides = {
  "chrome-desktop": {
    image: "chrome-desktop", alt: "inbox.guide.chromeDesktop.alt",
    steps: ["inbox.guide.chromeDesktop.open", "inbox.guide.chromeDesktop.allow"],
  },
  "chrome-android": {
    image: "chrome-android", alt: "inbox.guide.chromeAndroid.alt",
    steps: ["inbox.guide.chromeAndroid.open", "inbox.guide.chromeAndroid.allow"],
  },
  "firefox-desktop": {
    image: "firefox-desktop", alt: "inbox.guide.firefoxDesktop.alt",
    steps: ["inbox.guide.firefoxDesktop.open", "inbox.guide.firefoxDesktop.allow"],
  },
  "firefox-android": {
    image: "firefox-android", alt: "inbox.guide.firefoxAndroid.alt",
    steps: ["inbox.guide.firefoxAndroid.open", "inbox.guide.firefoxAndroid.allow"],
  },
  ios: {
    image: "ios", alt: "inbox.guide.ios.alt",
    steps: ["inbox.guide.ios.add", "inbox.guide.ios.open"],
  },
  "ios-settings": {
    image: null, alt: "", steps: ["inbox.guide.iosSettings.find", "inbox.guide.iosSettings.allow"],
  },
  other: { image: null, alt: "", steps: ["inbox.guide.other.allow"] },
} as const;

export function WebPushPermissionGuide({ guide, supported }: { guide: PushPermissionGuide; supported: boolean }) {
  const t = useMessages();
  if (!supported && guide !== "ios") return <p>{t("inbox.guide.unsupported")}</p>;
  const content = guides[guide];
  return <div className="grid gap-3">
    <p className="font-semibold">{guide === "ios" ? t("inbox.guide.home") : t("inbox.guide.blocked")}</p>
    {content.image && <img src={`/assets/notification-guide/${content.image}.svg`} alt={t(content.alt)} className="block h-auto w-full" />}
    <ol className="list-decimal space-y-1 pl-5">{content.steps.map(step => <li key={step}>{t(step)}</li>)}</ol>
  </div>;
}
