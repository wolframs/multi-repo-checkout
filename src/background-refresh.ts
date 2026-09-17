import * as vscode from "vscode";
import { BranchCache, CacheOptions } from "./branch-cache";
import { errorMessage } from "./git-commands";
import { ApiRepository, BranchCatalog } from "./types";

export interface BackgroundRefreshOptions extends CacheOptions {
    intervalMs: number;
}

export type ScheduleRefresh = (callback: () => void, delayMs: number) => vscode.Disposable;

/** Discovery reports why it failed, so a silent `undefined` still reaches the log. */
export type RepositoryProvider = (
    reportFailure: (reason: string) => void
) => Promise<ApiRepository[] | undefined>;

function isScheduled(options: BackgroundRefreshOptions): boolean {
    return options.enabled && options.intervalMs > 0;
}

/** Schedules after completion so slow fetches never accumulate overlapping runs. */
export class BackgroundRefresh implements vscode.Disposable {
    private timer?: vscode.Disposable;
    private running?: vscode.CancellationTokenSource;
    private disposed = false;
    /** Failures currently on the channel, by what failed. */
    private readonly outages = new Map<string, string>();

    constructor(
        private readonly cache: BranchCache,
        private readonly repositories: RepositoryProvider,
        private readonly options: () => BackgroundRefreshOptions,
        private readonly report: (message: string) => void,
        private readonly schedule: ScheduleRefresh = (callback, delay) => {
            const timer = setTimeout(callback, delay);
            return { dispose: () => clearTimeout(timer) };
        }
    ) {
        this.configure();
    }

    /** Re-arms the timer; a run already under way finishes and re-arms itself. */
    configure(): void {
        this.timer?.dispose();
        this.timer = undefined;
        if (!this.running) {
            this.arm();
        }
    }

    dispose(): void {
        this.disposed = true;
        this.timer?.dispose();
        this.running?.cancel();
    }

    private arm(): void {
        const options = this.options();
        if (!this.disposed && isScheduled(options)) {
            this.timer = this.schedule(() => { void this.refresh(); }, options.intervalMs);
        }
    }

    private async refresh(): Promise<void> {
        this.timer = undefined;
        const options = this.options();
        if (this.disposed || this.running || !isScheduled(options)) {
            return;
        }
        const cancellation = new vscode.CancellationTokenSource();
        this.running = cancellation;
        try {
            const repositories = await this.discover();
            if (repositories?.length && !cancellation.token.isCancellationRequested) {
                const catalog = await this.cache.collect(repositories, {
                    ...options,
                    forceRefresh: true,
                    cancellationToken: cancellation.token,
                });
                this.logOutcome(catalog);
            }
        } catch (error) {
            if (!cancellation.token.isCancellationRequested) {
                this.logTransition("run", `Background refs refresh failed: ${errorMessage(error)}`, "");
            }
        } finally {
            cancellation.dispose();
            this.running = undefined;
            this.arm();
        }
    }

    /**
     * Discovery failing is silent elsewhere by design, so it is logged here.
     * No repositories open is not a failure and stays silent.
     */
    private async discover(): Promise<ApiRepository[] | undefined> {
        let reason = "no Git repositories are available";
        const repositories = await this.repositories((message) => { reason = message; });
        this.logTransition(
            "discovery",
            repositories ? undefined : `Background refresh skipped: ${reason}`,
            "Background refresh resumed: Git repositories are available again"
        );
        return repositories;
    }

    private logOutcome(catalog: BranchCatalog): void {
        this.logTransition("run", undefined, "Background refs refresh succeeded again");
        for (const name of catalog.repositoryNames.values()) {
            const fetch = catalog.remoteRefreshFailures.find((failure) => failure.repository === name);
            this.logTransition(
                `fetch:${name}`,
                fetch && `Background fetch failed for ${name}: ${fetch.message}`,
                `Background fetch for ${name} succeeded again`
            );
            this.logTransition(
                `refs:${name}`,
                catalog.staleRepositories.includes(name)
                    ? `Background refs refresh failed for ${name}`
                    : undefined,
                `Background refs refresh for ${name} succeeded again`
            );
        }
    }

    /**
     * A persistent outage would otherwise write a line every interval, so a
     * failure is logged when it appears or changes, and its recovery once.
     */
    private logTransition(key: string, failure: string | undefined, recovered: string): void {
        const previous = this.outages.get(key);
        if (failure) {
            if (failure !== previous) {
                this.outages.set(key, failure);
                this.report(failure);
            }
        } else if (previous !== undefined) {
            this.outages.delete(key);
            this.report(recovered);
        }
    }
}
