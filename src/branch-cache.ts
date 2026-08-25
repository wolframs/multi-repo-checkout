import * as path from "path";
import * as vscode from "vscode";
import { mapWithConcurrency } from "./concurrency";
import { repositoryPath } from "./git-api";
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
    local: string[];
    remote: string[];
}

interface StoredCache {
    version: 1;
    repositories: Record<string, StoredRepository>;
}

interface LoadedRepository {
    snapshot: BranchSnapshot;
    updatedAt: number;
    stale: boolean;
    refreshed: boolean;
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
    private readonly inFlight = new Map<string, Promise<RepositoryLoad>>();

    constructor(private readonly state: vscode.Memento) {}

    async collect(
        repositories: ApiRepository[],
        options: CacheOptions
    ): Promise<BranchCatalog> {
        const now = options.now ?? Date.now();
        const stored = this.readStoredCache();
        const remoteRefreshFailures: BranchCatalog["remoteRefreshFailures"] = [];
        const activeKeys = new Set(repositories.map((repo) => repositoryCacheKey(repositoryPath(repo))));
        const loaded = await mapWithConcurrency(
            repositories,
            options.maxConcurrency ?? repositories.length,
            async (repository) => {
                const root = repositoryPath(repository);
                const key = repositoryCacheKey(root);
                const cached = stored.repositories[key];
                const fresh = options.enabled
                    && !options.forceRefresh
                    && options.ttlMs > 0
                    && cached
                    && now - cached.updatedAt <= options.ttlMs;

                if (fresh) {
                    options.onRepositoryLoaded?.(path.basename(root), true);
                    return {
                        snapshot: deserialize(cached),
                        updatedAt: cached.updatedAt,
                        stale: false,
                        refreshed: false,
                    } satisfies LoadedRepository;
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
                        return {
                            snapshot: deserialize(cached),
                            updatedAt: cached.updatedAt,
                            stale: true,
                            refreshed: false,
                        } satisfies LoadedRepository;
                    }
                    throw error;
                }
            }
        );

        const byRepository = new Map<string, BranchSnapshot>();
        const repositoryNames = new Map<string, string>();
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
            if (options.enabled) {
                if (entry.refreshed) {
                    stored.repositories[key] = serialize(root, entry);
                    storageChanged = true;
                }
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
            const local = [...snapshot.local].sort();
            const remote = [...snapshot.remote].sort();
            if (
                local.join("\0") !== entry.local.join("\0")
                || remote.join("\0") !== entry.remote.join("\0")
            ) {
                entry.local = local;
                entry.remote = remote;
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
            return { version: 1, repositories: {} };
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
        const existing = this.inFlight.get(key);
        if (existing) {
            return existing;
        }

        const request = (async (): Promise<RepositoryLoad> => {
            throwIfCancelled(options.cancellationToken);
            let remoteRefreshFailure: string | undefined;
            if (options.refreshRemote) {
                try {
                    await options.refreshRemote(repository);
                } catch (error) {
                    throwIfCancelled(options.cancellationToken);
                    remoteRefreshFailure = error instanceof Error
                        ? error.message
                        : String(error);
                }
            }
            throwIfCancelled(options.cancellationToken);
            const refs = await repository.getRefs(
                { pattern: ["refs/heads", "refs/remotes/origin"] },
                options.cancellationToken
            );
            return { snapshot: toSnapshot(refs), remoteRefreshFailure };
        })().finally(() => this.inFlight.delete(key));
        this.inFlight.set(key, request);
        return request;
    }
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

function deserialize(entry: StoredRepository): BranchSnapshot {
    return {
        local: new Set(entry.local),
        remote: new Set(entry.remote),
    };
}

function serialize(root: string, entry: LoadedRepository): StoredRepository {
    return {
        root,
        updatedAt: entry.updatedAt,
        local: [...entry.snapshot.local].sort(),
        remote: [...entry.snapshot.remote].sort(),
    };
}
