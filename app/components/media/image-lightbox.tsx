"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type LightboxComponent from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/styles.css";

const Lightbox = dynamic(() => import("yet-another-react-lightbox"), { ssr: false });
type Props = ComponentProps<typeof LightboxComponent>;

export function ImageLightbox({ plugins = [], labels, pixelated = false, ...props }: Pick<Props, "open" | "close" | "index" | "slides" | "plugins" | "labels"> & { pixelated?: boolean }) {
  return <Lightbox {...props}
    plugins={[Zoom, ...plugins]}
    carousel={{ finite: true }}
    controller={{ closeOnBackdropClick: true }}
    zoom={{ maxZoomPixelRatio: 4, scrollToZoom: true }}
    animation={{ fade: 150, swipe: 200 }}
    styles={pixelated ? { slide: { imageRendering: "pixelated" } } : undefined}
    labels={{ Close: "关闭看图", Next: "下一张", Previous: "上一张", "Zoom in": "放大", "Zoom out": "缩小", ...labels }}
  />;
}
