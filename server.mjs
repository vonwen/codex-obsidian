import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VaultService } from "./lib/vault.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const host = process.env.CODEX_OBSIDIAN_HOST || "127.0.0.1";
const port = Number(process.env.CODEX_OBSIDIAN_PORT || 43128);
const vaultRoot = process.env.OBSIDIAN_VAULT_PATH;
if (!vaultRoot) {
  throw new Error("Missing OBSIDIAN_VAULT_PATH. Set it to your Obsidian vault directory.");
}
const vault = await new VaultService(vaultRoot).initialize();
const indexHtml = await readFile(path.join(here, "public", "index.html"));

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 20 * 1024 * 1024) throw Object.assign(new Error("请求内容过大。"), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${host}:${port}`);

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; connect-src 'self'",
      });
      response.end(indexHtml);
      return;
    }

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { ready: true, vault: path.basename(vault.realRoot) });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/tree") {
      sendJson(response, 200, await vault.listTree());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/note") {
      sendJson(response, 200, { note: await vault.readNote(url.searchParams.get("path")) });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/search") {
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 80));
      sendJson(response, 200, await vault.searchNotes(url.searchParams.get("q") || "", limit));
      return;
    }

    if (request.method === "PUT" && url.pathname === "/api/note") {
      const body = await readJson(request);
      const note = await vault.saveNote(body.path, body.content, body.expectedMtimeMs);
      sendJson(response, 200, { note });
      return;
    }

    sendJson(response, 404, { error: "未找到该接口。" });
  } catch (error) {
    const status = error?.code === "EDIT_CONFLICT" ? 409 : error?.statusCode || 400;
    sendJson(response, status, { error: error?.message || "请求失败。" });
  }
});

server.listen(port, host, () => {
  console.log(`Codex Obsidian is available at http://${host}:${port}`);
});

