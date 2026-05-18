// SPDX-FileCopyrightText: 2025 The BAR Lobby Authors
//
// SPDX-License-Identifier: MIT

import { reactive } from "vue";
import {
    MatchmakingCancelledEventData,
    MatchmakingFoundEventData,
    MatchmakingFoundUpdateEventData,
    MatchmakingListOkResponseData,
    MatchmakingQueuesJoinedEventData,
    MatchmakingQueueUpdateEventData,
} from "tachyon-protocol/types";
import { tachyonStore } from "@renderer/store/tachyon.store";
import { notificationsApi } from "@renderer/api/notifications";

export enum MatchmakingStatus {
    Idle = "Idle",
    JoinRequested = "JoinRequested",
    Searching = "Searching",
    MatchFound = "MatchFound",
    MatchAccepted = "MatchAccepted",
}

export const matchmakingStore: {
    isInitialized: boolean;
    isDrawerOpen: boolean;
    status: MatchmakingStatus;
    errorMessage: string | null;
    selectedQueue: string;
    playlists: MatchmakingListOkResponseData["playlists"];
    isLoadingQueues: boolean;
    queueError?: string;
    playersReady?: number;
    playersQueued?: number;
    // Each playlist will have it's own boolean, as the 'needed' property of an object keyed to the playlist's names
    downloadsRequired: {
        [k: string]: {
            needed: boolean;
        };
    };
} = reactive({
    isInitialized: false,
    isDrawerOpen: false,
    status: MatchmakingStatus.Idle,
    errorMessage: null,
    selectedQueue: "1v1",
    playlists: [],
    isLoadingQueues: false,
    queueError: undefined,
    playersReady: 0,
    playersQueued: 0,
    downloadsRequired: {},
});

function onQueueUpdateEvent(data: MatchmakingQueueUpdateEventData) {
    console.log("Tachyon event: matchmaking/queueUpdate:", data);
    matchmakingStore.playersQueued = data.playersQueued;
}

function onLostEvent() {
    console.log("Tachyon event: matchmaking/lost: no data");
    matchmakingStore.status = MatchmakingStatus.Searching;
}

function onFoundUpdateEvent(data: MatchmakingFoundUpdateEventData) {
    console.log("Tachyon event: matchmaking/foundUpdate", data);
    matchmakingStore.playersReady = data.readyCount;
}

function onCancelledEvent(data: MatchmakingCancelledEventData) {
    console.log("Tachyon event: matchmaking/cancelled:", data);
    matchmakingStore.status = MatchmakingStatus.Idle;
}

function onFoundEvent(data: MatchmakingFoundEventData) {
    console.log("Tachyon event: matchmaking/found:", data);
    matchmakingStore.status = MatchmakingStatus.MatchFound;
    // Per spec, we have 10 seconds to send the ``matchmaking/ready`` request or we get cancelled from queue.
    // Probably better to track this timer on the UI side because the user will either need to 'ready' or 'cancel'
    // and they need to know this. Plus the UI has to "pop up" because they need to respond to it.
    // But we don't want to be "triggering" the UI from the store. Instead, we should add a watcher,
    // and when this value updates to MatchFound we can start our timer. Probably want a progress bar "counting down" too.
}

function onQueuesJoinedEvent(data: MatchmakingQueuesJoinedEventData) {
    console.log("Tachyon event: matchmaking/queuesJoined:", data);
    matchmakingStore.status = MatchmakingStatus.Searching;
}

async function sendListRequest() {
    matchmakingStore.isLoadingQueues = true;
    matchmakingStore.queueError = undefined;
    try {
        const response = await window.tachyon.request("matchmaking/list");
        console.log("Tachyon: matchmaking/list:", response.data);
        matchmakingStore.playlists = response.data.playlists;

        // Set default selected queue if current selection is not available
        const hasSelectedQueue = matchmakingStore.playlists.some((playlist) => playlist.id === matchmakingStore.selectedQueue);
        if (matchmakingStore.playlists.length > 0 && !hasSelectedQueue) {
            matchmakingStore.selectedQueue = matchmakingStore.playlists[0].id;
        }
        // Clear the "downloadsRequired" list because we have all-new playlist response
        matchmakingStore.downloadsRequired = {};
        // Check required assets for each queue and kick off downloads for any that are missing.
        matchmakingStore.playlists.forEach(async (queue) => {
            matchmakingStore.downloadsRequired[queue.id] = { needed: await checkAndDownloadMissingAssets(queue) };
        });
    } catch (error) {
        console.error("Tachyon error: matchmaking/list:", error);
        notificationsApi.alert({ text: "Tachyon error: matchmaking/list", severity: "error" });
        matchmakingStore.queueError = "Failed to retrieve available queues";
    } finally {
        matchmakingStore.isLoadingQueues = false;
    }
}

type QueueAssets = Pick<MatchmakingListOkResponseData["playlists"][number], "engines" | "games" | "maps">;

async function checkAndDownloadMissingAssets(queue: QueueAssets): Promise<boolean> {
    let anyMissing = false;

    for (const { version } of queue.engines) {
        if (!(await window.engine.isVersionInstalled(version))) {
            anyMissing = true;
            window.engine.downloadEngine(version).catch((err) => console.error("Failed to download engine:", version, err));
        }
    }

    for (const { springName } of queue.games) {
        if (!(await window.game.isVersionInstalled(springName))) {
            anyMissing = true;
            window.game.downloadGame(springName).catch((err) => console.error("Failed to download game:", springName, err));
        }
    }

    for (const { springName } of queue.maps) {
        if (!(await window.maps.isVersionInstalled(springName))) {
            anyMissing = true;
            window.maps.downloadMap(springName).catch((err) => console.error("Failed to download map:", springName, err));
        }
    }

    return anyMissing;
}

export function getPlaylistName(id: string): string {
    const playlist = matchmakingStore.playlists.find((playlist) => playlist.id === id);
    return playlist?.name || id;
}

async function sendQueueRequest() {
    if (matchmakingStore.downloadsRequired[matchmakingStore.selectedQueue] == undefined) {
        notificationsApi.alert({ text: "Bad queue data; refreshing list.", severity: "error" });
        await sendListRequest();
        return;
    }
    if (matchmakingStore.downloadsRequired[matchmakingStore.selectedQueue].needed) {
        notificationsApi.alert({ text: "You have downloads required to join this queue.", severity: "info" });
        return;
    }
    matchmakingStore.status = MatchmakingStatus.JoinRequested; // Initial state, likely short-lived.
    try {
        matchmakingStore.errorMessage = null;
        // TODO: fix matchmaking that broke with the tachyon update: https://github.com/beyond-all-reason/bar-lobby/issues/545
        const response = await window.tachyon.request("matchmaking/queue", {
            queues: [
                /* matchmakingStore.selectedQueue */
            ],
        });
        console.log("Tachyon: matchmaking/queue:", response.status);
        matchmakingStore.status = MatchmakingStatus.Searching;
    } catch (error) {
        console.error("Tachyon error: matchmaking/queue:", error);
        notificationsApi.alert({ text: "Tachyon error: matchmaking/queue", severity: "error" });
        matchmakingStore.errorMessage = "Error with matchmaking/queue";
        matchmakingStore.status = MatchmakingStatus.Idle;
    }
}

async function sendCancelRequest() {
    matchmakingStore.status = MatchmakingStatus.Idle;
    try {
        const response = await window.tachyon.request("matchmaking/cancel");
        console.log("Tachyon: matchmaking/cancel:", response.status);
    } catch (error) {
        console.error("Tachyon: matchmaking/cancel:", error);
        notificationsApi.alert({ text: "Tachyon error: matchmaking/cancel", severity: "error" });
        matchmakingStore.errorMessage = "Error with matchmaking/cancel";
    }
}

async function sendReadyRequest() {
    matchmakingStore.status = MatchmakingStatus.MatchAccepted;
    try {
        const response = await window.tachyon.request("matchmaking/ready");
        console.log("Tachyon: matchmaking/ready:", response.status);
    } catch (error) {
        matchmakingStore.status = MatchmakingStatus.Idle;
        console.error("Tachyon error: matchmaking/ready:", error);
        notificationsApi.alert({ text: "Tachyon error: matchmaking/ready", severity: "error" });
        matchmakingStore.errorMessage = "Error with matchmaking/ready";
    }
}

async function refreshDownloadsRequired() {
    for (const queue of matchmakingStore.playlists) {
        matchmakingStore.downloadsRequired[queue.id] = { needed: await checkAndDownloadMissingAssets(queue) };
    }
}

export async function initializeMatchmakingStore() {
    if (matchmakingStore.isInitialized) return;

    window.tachyon.onEvent("matchmaking/queueUpdate", onQueueUpdateEvent);

    window.tachyon.onEvent("matchmaking/lost", onLostEvent);

    window.tachyon.onEvent("matchmaking/foundUpdate", onFoundUpdateEvent);

    window.tachyon.onEvent("matchmaking/cancelled", onCancelledEvent);

    window.tachyon.onEvent("matchmaking/found", onFoundEvent);

    window.tachyon.onEvent("matchmaking/queuesJoined", onQueuesJoinedEvent);

    window.downloads.onDownloadEngineComplete(() => refreshDownloadsRequired());
    window.downloads.onDownloadGameComplete(() => refreshDownloadsRequired());
    window.downloads.onDownloadMapComplete(() => refreshDownloadsRequired());

    if (tachyonStore.isConnected) {
        await sendListRequest();
    }

    matchmakingStore.isInitialized = true;
}

export const matchmaking = { sendCancelRequest, sendQueueRequest, sendReadyRequest, sendListRequest };
