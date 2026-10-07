import { createServer } from "node:http";

/**
 * One process, two jobs: Next handles pages and API routes, Socket.IO handles
 * the live rooms. Splitting them across two Render services would double the
 * instance-hours this project is built not to spend.
 *
 * `--prod` is how `pnpm start` asks for the production build without relying on
 * a shell that can spell `NODE_ENV=production` (Windows cannot). NODE_ENV is set
 * before Next is imported, because Next reads it while its modules initialise.
 */
const production = process.argv.includes("--prod");
if (production) process.env.NODE_ENV = "production";

const next = (await import("next")).default;
const { attachCollab } = await import("./collab.mjs");

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const dev = !production;

const app = next({ dev });
const handle = app.getRequestHandler();

await app.prepare();

const server = createServer((request, response) => {
  handle(request, response).catch((error) => {
    console.error("PenPaper: request failed", error);
    if (!response.headersSent) response.statusCode = 500;
    response.end();
  });
});

attachCollab(server);

server.listen(port, () => {
  console.log(
    `> PenPaper ready on http://localhost:${port} as ${production ? "production" : "development"}`,
  );
});

const shutdown = () => {
  server.close(() => process.exit(0));
  // A stuck keep-alive connection must not outlive the deploy.
  setTimeout(() => process.exit(0), 5_000).unref();
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
