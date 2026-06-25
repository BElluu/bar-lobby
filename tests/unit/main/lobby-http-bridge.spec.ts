// SPDX-FileCopyrightText: 2026 The BAR Lobby Authors
//
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("lobby http bridge service", () => {
    let requestHandler: ((req: { method?: string; url?: string }, res: { writeHead: (...args: unknown[]) => unknown; end: (body?: string) => unknown }) => void) | undefined;
    let server: {
        on: ReturnType<typeof vi.fn>;
        listen: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        requestHandler = undefined;

        server = {
            on: vi.fn(() => server),
            listen: vi.fn((_port: number, _host: string, cb: () => void) => {
                cb();
                return server;
            }),
            close: vi.fn(),
        };

        vi.doMock("node:http", () => ({
            default: {
                createServer: vi.fn((handler: typeof requestHandler) => {
                    requestHandler = handler;
                    return server;
                }),
            },
        }));

        vi.doMock("@main/utils/logger", () => ({
            logger: vi.fn().mockReturnValue({
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
            }),
        }));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("returns an interstitial page that points at the canonical protocol url", async () => {
        const { lobbyHttpBridgeService } = await import("@main/services/lobby-http-bridge.service");

        await lobbyHttpBridgeService.init();

        expect(requestHandler).toBeDefined();

        let statusCode: number | undefined;
        let headers: Record<string, string> | undefined;
        let body: string | undefined;
        const response: any = {
            writeHead: vi.fn((status: number, responseHeaders: Record<string, string>) => {
                statusCode = status;
                headers = responseHeaders;
                return response;
            }),
            end: vi.fn((content?: string) => {
                body = content;
                return response;
            }),
        };

        requestHandler?.({ method: "GET", url: "/internal/ping?id=555" }, response);

        expect(statusCode).toBe(200);
        expect(headers).toEqual({ "Content-Type": "text/html; charset=utf-8" });
        expect(body).toContain('const protocolUrl = "barrts://internal/ping?id=555"');
        expect(body).toContain('<button type="button" onclick="openLobby()">Open BAR Lobby</button>');
        expect(body).toContain('<a href="barrts://internal/ping?id=555">click here</a>');

        lobbyHttpBridgeService.close();
    });

    it("keeps the legacy /run prefix working while the local bridge is temporary", async () => {
        const { lobbyHttpBridgeService } = await import("@main/services/lobby-http-bridge.service");

        await lobbyHttpBridgeService.init();

        let body: string | undefined;
        const response: any = {
            writeHead: vi.fn(() => response),
            end: vi.fn((content?: string) => {
                body = content;
                return response;
            }),
        };

        requestHandler?.({ method: "GET", url: "/run/internal/ping" }, response);

        expect(body).toContain('const protocolUrl = "barrts://internal/ping"');

        lobbyHttpBridgeService.close();
    });
});
