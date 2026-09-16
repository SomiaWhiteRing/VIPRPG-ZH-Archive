import { ImageLightbox } from "@/app/components/media/image-lightbox";
import type { ForumImage } from "@/lib/forum";
import Counter from "yet-another-react-lightbox/plugins/counter";
import "yet-another-react-lightbox/plugins/counter.css";
export function ForumLightbox({
  images,
  active,
  setActive,
}: {
  images: ForumImage[];
  active: number;
  setActive: (n: number) => void;
}) {
  return (
    <ImageLightbox
      open={active >= 0}
      close={() => setActive(-1)}
      index={active}
      slides={images.map((image, index) => ({
        src: image.url,
        width: image.width,
        height: image.height,
        alt: `图片 ${index + 1}`,
      }))}
      plugins={[Counter]}
    />
  );
}
