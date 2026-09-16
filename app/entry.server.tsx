import { renderToReadableStream } from "react-dom/server";
import type { EntryContext } from "react-router";
import { ServerRouter } from "react-router";

export default async function handleRequest(
  request: Request,
  status: number,
  headers: Headers,
  context: EntryContext,
) {
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "private, no-store");
  if (request.method === "HEAD") return new Response(null, { status, headers });
  const body = await renderToReadableStream(
    <ServerRouter context={context} url={request.url} />,
    {
      signal: request.signal,
      onError(error) {
        console.error("SSR rendering failed", error);
        status = 500;
      },
    },
  );
  await body.allReady;
  return new Response(body, { status, headers });
}
