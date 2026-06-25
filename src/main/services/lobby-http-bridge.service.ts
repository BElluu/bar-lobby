// SPDX-FileCopyrightText: 2026 The BAR Lobby Authors
//
// SPDX-License-Identifier: MIT

import http from "node:http";
import { buildLobbyProtocolUrl } from "@main/lobbyProtocol/lobby-protocol-router";
import { logger } from "@main/utils/logger";

const log = logger("lobby-http-bridge.service.ts");

const PORT = 47777;

function buildOpenHtml(protocolUrl: string): string {
    const escaped = protocolUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    return `<!DOCTYPE html>
<html>
<head>
  <title>Opening BAR Lobby...</title>
  <script>
    const protocolUrl = ${JSON.stringify(protocolUrl)};
    function openLobby() {
      window.location.href = protocolUrl;
    }
    window.addEventListener("DOMContentLoaded", () => {
      window.setTimeout(openLobby, 100);
    });
  </script>
</head>
<body>
  <p>Opening BAR Lobby...</p>
  <button type="button" onclick="openLobby()">Open BAR Lobby</button>
  <p>If the app did not open automatically, <a href="${escaped}">click here</a>.</p>
</body>
</html>`;
}

function getProtocolRoute(pathname: string): { handler: string; action: string } | null {
    const segments = pathname.split("/").filter(Boolean);
    if (segments.length === 2) {
        const [handler, action] = segments;
        return { handler, action };
    }
    if (segments.length === 3 && segments[0] === "run") {
        const [, handler, action] = segments;
        return { handler, action };
    }
    return null;
}

let server: http.Server | null = null;

function init(): Promise<void> {
    return new Promise((resolve) => {
        server = http.createServer((req, res) => {
            if (req.method !== "GET") {
                res.writeHead(405).end();
                return;
            }

            let parsedUrl: URL;
            try {
                parsedUrl = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
            } catch {
                res.writeHead(400).end();
                return;
            }

            const route = getProtocolRoute(parsedUrl.pathname);
            if (!route) {
                res.writeHead(404).end("Not found");
                return;
            }

            const protocolUrl = buildLobbyProtocolUrl(route.handler, route.action, parsedUrl.search);

            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(buildOpenHtml(protocolUrl));
        });

        server.on("error", (err) => {
            log.warn(`HTTP bridge failed to start: ${err.message}`);
            server = null;
            resolve();
        });

        server.listen(PORT, "127.0.0.1", () => {
            log.info(`HTTP bridge listening on http://localhost:${PORT}`);
            resolve();
        });
    });
}

function close(): void {
    server?.close();
    server = null;
}

export const lobbyHttpBridgeService = { init, close };
