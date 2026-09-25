import { useNavigation } from "react-router";

export function NavigationProgress() {
  const navigation = useNavigation();

  if (navigation.state !== "loading") return null;

  return (
    <div
      aria-label="页面加载中"
      className="site-navigation-progress pointer-events-none fixed inset-x-0 top-0 z-[60] h-[3px] origin-left bg-primary shadow-[0_0_8px_var(--color-primary)]"
      role="progressbar"
    />
  );
}
