import { ClientOnly } from "@/app/components/ui/client-only";
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
          Lightbox: "图片查看器",
          "Photo gallery": "图片集",
          Carousel: "图片轮播",
          Slide: "图片",
          "{index} of {total}": "第 {index} 张，共 {total} 张",
          Close: "关闭看图",
          Next: "下一张",
          Previous: "上一张",
          "Zoom in": "放大",
          "Zoom out": "缩小",
          ...labels,
        }}
      />
    </ClientOnly>
  );
}
