import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const portFlag = process.argv.indexOf("--port");
const port = Number(portFlag === -1 ? 3000 : process.argv[portFlag + 1]);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("Use --port with an integer from 1 to 65535.");
}
const types = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
]);

createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const relative = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\]*\.\.[/\\])+/, "");
    let file = resolve(root, `.${sep}${relative}`);
    if (file !== root && !file.startsWith(`${root}${sep}`)) throw new Error("outside root");
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    response.writeHead(200, { "content-type": types.get(extname(file)) ?? "application/octet-stream" });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found\n");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`MikoMarkup demo: http://127.0.0.1:${port}/demo/`);
});
