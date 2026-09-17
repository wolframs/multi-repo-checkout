import * as path from "path";
import * as vscode from "vscode";
import { mapWithConcurrency } from "./concurrency";
import { repositoryPath } from "./git-api";
import { errorMessage } from "./git-commands";
import { RemoteRefresher } from "./remote-refresh";
import {
    ApiRepository,
    BranchCatalog,
    BranchSnapshot,
    Ref,
    RefType,
} from "./types";

const CACHE_KEY = "branchCache.v1";

interface StoredRepository {
    root: string;
    updatedAt: number;
    revision: number;
    local: string[];
    remote: string[];
}

interface StoredCache {
    version: 1;
    /**
     * Wall-clock time cannot order two writes: it is stamped when a collection
     * starts, so a slow early run can land after a fast later one, and two runs
     * can share a millisecond. Revisions are allocated at write time instead.
     */
    nextRevision: number;
    repositories: Record<string, StoredRepository>;
}

interface LoadedRepository {
    snapshot: BranchSnapshot;
    updatedAt: number;
    /** The stored revision this snapshot reflects; 0 until it has been persisted. */
    revision: number;
    stale: boolean;
    refreshed: boolean;
}

interface InFlightLoad {
    key: string;
    promise: Promise<RepositoryLoad>;
    source: vscode.CancellationTokenSource;
    waiters: number;
    settled: boolean;
}

interface RepositoryLoad {
    snapshot: BranchSnapshot;
    remoteRefreshFailure?: string;
}

export interface CacheOptions {
    enabled: boolean;
    ttlMs: number;
    forceRefresh?: boolean;
    now?: number;
    maxConcurrency?: number;
    cancellationToken?: vscode.CancellationToken;
    refreshRemote?: RemoteRefresher;
    onRepositoryLoaded?: (repoName: string, fromCache: boolean) => void;
}

export function repositoryCacheKey(root: string): string {
    const normalized = path.normalize(root);
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export class BranchCache {
    private readonly inFlight = new Map<string, InFlightLoad>();

    constructor(private readonly state: vscode.Memento) {}

    async collect(
        repositories: ApiRepository[],
        options: CacheOptions
    ): Promise<BranchCatalog> {
        const now = options.now ?? Date.now();
        const initial = this.readStoredCache();
        const remoteRefreshFailures: BranchCatalog["remoteRefreshFailures"] = [];
        const activeKeys = new Set(repositories.map((repo) => repositoryCacheKey(repositoryPath(repo))));
        const loaded = await mapWithConcurrency(
            repositories,
            options.maxConcurrency ?? repositories.length,
            async (repository) => {
                const root = repositoryPath(repository);
                const cached = initial.repositories[repositoryCacheKey(root)];
                const fresh = options.enabled
                    && !options.forceRefresh
                    && options.ttlMs > 0
                    && cached
                    && now - cached.updatedAt <= options.ttlMs;

                if (fresh) {
                    options.onRepositoryLoaded?.(path.basename(root), true);
                    return fromCached(cached, false);
                }

                try {
                    const load = await this.loadRepository(repository, options);
                    if (load.remoteRefreshFailure) {
                        remoteRefreshFailures.push({
                            repository: path.basename(root),
                            message: load.remoteRefreshFailure,
                        });
                    }
                    options.onRepositoryLoaded?.(path.basename(root), false);
                    return {
                        snapshot: load.snapshot,
                        updatedAt: now,
                        revision: 0,
                        stale: false,
                        refreshed: true,
                    } satisfies LoadedRepository;
                } catch (error) {
                    if (
                        error instanceof vscode.CancellationError
                        || options.cancellationToken?.isCancellationRequested
                    ) {
                        throw new vscode.CancellationError();
                    }
                    if (options.enabled && cached) {
                        options.onRepositoryLoaded?.(path.basename(root), true);
                        return fromCached(cached, true);
                    }
                    throw error;
                }
            }
        );

        throwIfCancelled(options.cancellationToken);
        // Another collection or a checkout may have written while Git ran.
        const stored = this.readStoredCache();
        const byRepository = new Map<string, BranchSnapshot>();
        const repositoryNames = new Map<string, string>();
        const repositoryRevision = new Map<string, number>();
        const branches = new Set<string>();
        const staleRepositories: string[] = [];
        let storageChanged = false;

        repositories.forEach((repository, index) => {
            const root = repositoryPath(repository);
            const key = repositoryCacheKey(root);
            const entry = loaded[index];
            byRepository.set(key, entry.snapshot);
            repositoryNames.set(key, path.basename(root));
            for (const branch of entry.snapshot.local) {
                branches.add(branch);
            }
            for (const branch of entry.snapshot.remote) {
                branches.add(branch);
            }
            if (entry.stale) {
                staleRepositories.push(path.basename(root));
            }
            if (options.enabled && entry.refreshed) {
                const revision = stored.nextRevision++;
                stored.repositories[key] = serialize(root, entry, revision);
                repositoryRevision.set(key, revision);
                storageChanged = true;
            } else {
                repositoryRevision.set(key, entry.revision);
            }
        });

        if (options.enabled) {
            for (const key of Object.keys(stored.repositories)) {
                if (!activeKeys.has(key)) {
                    delete stored.repositories[key];
                    storageChanged = true;
                }
            }
            if (storageChanged) {
                await this.state.update(CACHE_KEY, stored);
            }
        }

        return {
            branches,
            byRepository,
            repositoryNames,
            repositoryRevision,
            staleRepositories,
            remoteRefreshFailures,
        };
    }

    async clear(): Promise<void> {
        this.inFlight.clear();
        await this.state.update(CACHE_KEY, undefined);
    }

    async persistLocalChanges(catalog: BranchCatalog): Promise<void> {
        const stored = this.readStoredCache();
        let changed = false;
        for (const [key, snapshot] of catalog.byRepository) {
            const entry = stored.repositories[key];
            if (!entry) {
                continue;
            }
            // A newer revision means a background refresh wrote refs since this
            // catalog was built; keep those and only add what the checkout produced.
            const keepStored = entry.revision > (catalog.repositoryRevision.get(key) ?? 0);
            const local = sortedRefs(keepStored ? [...entry.local, ...snapshot.local] : snapshot.local);
            const remote = sortedRefs(keepStored ? [...entry.remote, ...snapshot.remote] : snapshot.remote);
            if (
                local.join("\0") !== entry.local.join("\0")
                || remote.join("\0") !== entry.remote.join("\0")
            ) {
                entry.local = local;
                entry.remote = remote;
                entry.revision = stored.nextRevision++;
                changed = true;
            }
        }
        if (changed) {
            await this.state.update(CACHE_KEY, stored);
        }
    }

    private readStoredCache(): StoredCache {
        const value = this.state.get<StoredCache>(CACHE_KEY);
        if (!value || value.version !== 1 || !value.repositories) {
            return { version: 1, nextRevision: 1, repositories: {} };
        }
        // Caches written before 0.3.2 carry neither the counter nor entry revisions.
        value.nextRevision ??= 1;
        for (const entry of Object.values(value.repositories)) {
            entry.revision ??= 0;
        }
        return value;
    }

    private loadRepository(
        repository: ApiRepository,
        options: CacheOptions
    ): Promise<RepositoryLoad> {
        const key = `${repositoryCacheKey(repositoryPath(repository))}:${
            options.refreshRemote ? "remote" : "local"
        }`;
        let request = this.inFlight.get(key);
        if (!request) {
            // The shared load outlives any single caller, so it runs under its own
            // token and is cancelled only once every caller has walked away.
            const source = new vscode.CancellationTokenSource();
            const pending: InFlightLoad = {
                key,
                source,
                waiters: 0,
                settled: false,
                promise: this.runLoad(repository, options, source.token).finally(() => {
                    pending.settled = true;
                    this.evictLoad(pending);
                    source.dispose();
                }),
            };
            // Abandoned loads reject with nobody listening.
            pending.promise.catch(() => undefined);
            this.inFlight.set(key, pending);
            request = pending;
        }
        return this.joinLoad(request, options.cancellationToken);
    }

    private joinLoad(
        request: InFlightLoad,
        token?: vscode.CancellationToken
    ): Promise<RepositoryLoad> {
        if (token?.isCancellationRequested) {
            return Promise.reject(new vscode.CancellationError());
        }
        request.waiters++;
        return new Promise<RepositoryLoad>((resolve, reject) => {
            let delivered = false;
            const finish = (deliver: () => void): void => {
                if (delivered) {
                    return;
                }
                delivered = true;
                subscription?.dispose();
                this.releaseLoad(request);
                deliver();
            };
            const subscription = token?.onCancellationRequested(() =>
                finish(() => reject(new vscode.CancellationError()))
            );
            request.promise.then(
                (load) => finish(() => resolve(load)),
                (error) => finish(() => reject(error))
            );
        });
    }

    private releaseLoad(request: InFlightLoad): void {
        request.waiters--;
        if (request.waiters > 0 || request.settled) {
            return;
        }
        // Evict before cancelling so a caller arriving while this load unwinds
        // starts a fresh one instead of inheriting the cancellation.
        this.evictLoad(request);
        request.source.cancel();
    }

    /** Only ever drops its own entry, never a replacement registered since. */
    private evictLoad(request: InFlightLoad): void {
        if (this.inFlight.get(request.key) === request) {
            this.inFlight.delete(request.key);
        }
    }

    private async runLoad(
        repository: ApiRepository,
        options: CacheOptions,
        token: vscode.CancellationToken
    ): Promise<RepositoryLoad> {
        throwIfCancelled(token);
        let remoteRefreshFailure: string | undefined;
        if (options.refreshRemote) {
            try {
                await options.refreshRemote(repository);
            } catch (error) {
                throwIfCancelled(token);
                remoteRefreshFailure = errorMessage(error);
            }
        }
        throwIfCancelled(token);
        const refs = await repository.getRefs(
            { pattern: ["refs/heads", "refs/remotes/origin"] },
            token
        );
        return { snapshot: toSnapshot(refs), remoteRefreshFailure };
    }
}

function sortedRefs(refs: Iterable<string>): string[] {
    return [...new Set(refs)].sort();
}

function throwIfCancelled(token?: vscode.CancellationToken): void {
    if (token?.isCancellationRequested) {
        throw new vscode.CancellationError();
    }
}

function toSnapshot(refs: Ref[]): BranchSnapshot {
    const local = new Set<string>();
    const remote = new Set<string>();
    for (const ref of refs) {
        if (!ref.name) {
            continue;
        }
        if (ref.type === RefType.Head) {
            local.add(ref.name);
        } else if (
            ref.type === RefType.RemoteHead
            && ref.remote === "origin"
            && ref.name.startsWith("origin/")
            && ref.name !== "origin/HEAD"
        ) {
            remote.add(ref.name.slice("origin/".length));
        }
    }
    return { local, remote };
}

function fromCached(cached: StoredRepository, stale: boolean): LoadedRepository {
    return {
        snapshot: {
            local: new Set(cached.local),
            remote: new Set(cached.remote),
        },
        updatedAt: cached.updatedAt,
        revision: cached.revision,
        stale,
        refreshed: false,
    };
}

function serialize(
    root: string,
    entry: LoadedRepository,
    revision: number
): StoredRepository {
    return {
        root,
        updatedAt: entry.updatedAt,
        revision,
        local: sortedRefs(entry.snapshot.local),
        remote: sortedRefs(entry.snapshot.remote),
    };
}
