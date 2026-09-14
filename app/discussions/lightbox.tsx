"use client";
import Lightbox from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import Counter from "yet-another-react-lightbox/plugins/counter";
import "yet-another-react-lightbox/styles.css";
import "yet-another-react-lightbox/plugins/counter.css";
import type {ForumImage} from "@/lib/forum";
export function ForumLightbox({images,active,setActive}:{images:ForumImage[];active:number;setActive:(n:number)=>void}){return (
      <Lightbox
        open={active >= 0}
        close={() => setActive(-1)}
        index={active}
        slides={images.map((image, index) => ({
          src: image.url,
          width: image.width,
          height: image.height,
          alt: `图片 ${index + 1}`,
        }))}
        plugins={[Zoom, Counter]}
        carousel={{ finite: true }}
        controller={{ closeOnBackdropClick: true }}
        zoom={{ maxZoomPixelRatio: 4, scrollToZoom: true }}
        animation={{ fade: 150, swipe: 200 }}
        labels={{
          Close: "关闭看图",
          Next: "下一张",
          Previous: "上一张",
          "Zoom in": "放大",
          "Zoom out": "缩小",
        }}
      />
);}
