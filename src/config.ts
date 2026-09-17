import * as vscode from "vscode";
import { CacheOptions } from "./branch-cache";
import { RemoteRefreshPolicy } from "./types";

const CACHE_SECTION = "multiRepoBranchSwitcher.cache";
const DEFAULT_BACKGROUND_REFRESH_SECONDS = 300;
/** setTimeout overflows its 32-bit millisecond delay beyond this. */
const MAX_TIMER_SECONDS = 2_147_483;

export function getConfigDefaultBranch(): string {
    const config = vscode.workspace.getConfiguration("multiRepoBranchSwitcher");
    return config.get<string>("defaultBranchName", "master");
}

export function getConfigRegisterChangesDelay(): number {
    const config = vscode.workspace.getConfiguration("multiRepoBranchSwitcher");
    return config.get<number>("registerChangesDelay", 1500);
}

export function getConfigAutoReloadWindow(): string {
    const config = vscode.workspace.getConfiguration("multiRepoBranchSwitcher");
    return config.get<string>("autoReloadWindow", "Ask");
}

export function getConfigAutoPullBranchUpdates(): string {
    const config = vscode.workspace.getConfiguration("multiRepoBranchSwitcher");
    return config.get<string>("autoPullBranchUpdates", "Ask");
}

export function getConfigPruneCutoffDays(): number {
    const config = vscode.workspace.getConfiguration("multiRepoBranchSwitcher.prune");
    return config.get<number>("cutoffDays", 14);
}

export function getConfigPruneProtected(): string[] {
    const config = vscode.workspace.getConfiguration("multiRepoBranchSwitcher.prune");
    return config.get<string[]>("protected", ["^(main|master|develop)$"]);
}

export function getConfigPruneDryRun(): boolean {
    const config = vscode.workspace.getConfiguration("multiRepoBranchSwitcher.prune");
    return config.get<boolean>("dryRun", false);
}

export function getConfigCacheEnabled(): boolean {
    const config = vscode.workspace.getConfiguration(CACHE_SECTION);
    return config.get<boolean>("enabled", true);
}

export function getConfigCacheTtlSeconds(): number {
    const config = vscode.workspace.getConfiguration(CACHE_SECTION);
    return clamp(config.get<number>("ttlSeconds", 3_600), 0, Infinity, 3_600);
}

export function getConfigBackgroundRefreshIntervalSeconds(): number {
    const config = vscode.workspace.getConfiguration(CACHE_SECTION);
    return clamp(
        config.get<number>("backgroundRefreshIntervalSeconds", DEFAULT_BACKGROUND_REFRESH_SECONDS),
        0,
        MAX_TIMER_SECONDS,
        DEFAULT_BACKGROUND_REFRESH_SECONDS
    );
}

/** The cache settings every collection shares; callers add their own flags, token and refresher. */
export function getConfigCacheOptions(): Pick<CacheOptions, "enabled" | "ttlMs" | "maxConcurrency"> {
    return {
        enabled: getConfigCacheEnabled(),
        ttlMs: getConfigCacheTtlSeconds() * 1000,
        maxConcurrency: getConfigMaxConcurrentRepositories(),
    };
}

/**
 * Only the settings that govern the background timer force a reschedule;
 * everything else is read afresh when the next run starts.
 */
export function affectsBackgroundSchedule(
    event: Pick<vscode.ConfigurationChangeEvent, "affectsConfiguration">
): boolean {
    return [`${CACHE_SECTION}.enabled`, `${CACHE_SECTION}.backgroundRefreshIntervalSeconds`]
        .some((section) => event.affectsConfiguration(section));
}

export function getConfigRemoteRefreshPolicy(): RemoteRefreshPolicy {
    const config = vscode.workspace.getConfiguration(
        "multiRepoBranchSwitcher.remoteRefresh"
    );
    const policy = config.get<string>("policy", "When Cache Expires");
    return policy === "Never" || policy === "Always"
        ? policy
        : "When Cache Expires";
}

export function getConfigPreflightEnabled(): boolean {
    const config = vscode.workspace.getConfiguration(
        "multiRepoBranchSwitcher.preflight"
    );
    return config.get<boolean>("enabled", false);
}

export function getConfigMaxConcurrentRepositories(): number {
    const config = vscode.workspace.getConfiguration("multiRepoBranchSwitcher");
    return clamp(Math.floor(config.get<number>("maxConcurrentRepositories", 4)), 1, 32, 4);
}

function clamp(value: number, min: number, max: number, fallback: number): number {
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
