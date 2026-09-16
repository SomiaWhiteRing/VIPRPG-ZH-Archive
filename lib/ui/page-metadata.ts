export type PageMetadata = {
  title?: string;
  description?: string;
  alternates?: { canonical?: string };
};
export function pageMetaDescriptors(value?: PageMetadata) {
  return [
    { title: value?.title ?? "VIPRPG.org" },
    {
      name: "description",
      content: value?.description ?? "RPG Maker 作品发现、游玩与下载空间",
    },
    ...(value?.alternates?.canonical
      ? [
          {
            tagName: "link",
            rel: "canonical",
            href: value.alternates.canonical,
          },
        ]
      : []),
  ];
}
