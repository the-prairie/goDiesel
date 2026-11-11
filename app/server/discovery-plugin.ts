import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { discoveryResponse } from "./discovery";
export function discoveryPlugin(): Plugin {
  const middleware = async (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ) => {
    if (req.url?.split("?")[0] !== "/api/discovery") return next();
    const result = await discoveryResponse(
      new Request(`http://localhost${req.url}`, { method: req.method }),
    );
    res.statusCode = result.status;
    result.headers.forEach((v, k) => res.setHeader(k, v));
    res.end(await result.text());
  };
  return {
    name: "godiesel-route-discovery",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
