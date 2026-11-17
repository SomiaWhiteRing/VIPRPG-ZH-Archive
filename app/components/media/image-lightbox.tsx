import { ClientOnly } from "@/app/components/ui/client-only";
import { useMessages } from "@/lib/i18n/react";
import type { ComponentProps } from "react";
import { lazy } from "react";
import type LightboxComponent from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import Counter from "yet-another-react-lightbox/plugins/counter";
import "yet-another-react-lightbox/styles.css";
import "yet-another-react-lightbox/plugins/counter.css";
import "./image-lightbox.css";

const Lightbox = lazy(() => import("yet-another-react-lightbox"));
type Props = ComponentProps<typeof LightboxComponent>;

export function ImageLightbox({
  plugins = [],
  labels,
  pixelated = false,
  ...props
}: Pick<
  Props,
  | "open"
  | "close"
  | "index"
  | "slides"
  | "plugins"
  | "labels"
  | "toolbar"
  | "on"
> & {
  pixelated?: boolean;
}) {
  const t = useMessages();
  return (
    <ClientOnly>
      <Lightbox
        {...props}
        className="archive-lightbox"
        plugins={[Zoom, Counter, ...plugins]}
        carousel={{ finite: true, padding: 0 }}
        controller={{ closeOnBackdropClick: true, aria: true }}
        zoom={{ maxZoomPixelRatio: 4, scrollToZoom: true }}
        animation={{ fade: 150, swipe: 200 }}
        styles={
          pixelated ? { slide: { imageRendering: "pixelated" } } : {}
        }
        labels={{
          Lightbox: t("lightbox.label"),
          "Photo gallery": t("lightbox.gallery"),
          Carousel: t("lightbox.carousel"),
          Slide: t("lightbox.slide"),
          "{index} of {total}": t("lightbox.position", { index: "{index}", total: "{total}" }),
          Close: t("lightbox.close"),
          Next: t("lightbox.next"),
          Previous: t("lightbox.previous"),
          "Zoom in": t("lightbox.zoomIn"),
          "Zoom out": t("lightbox.zoomOut"),
          ...labels,
        }}
      />
    </ClientOnly>
  );
}
