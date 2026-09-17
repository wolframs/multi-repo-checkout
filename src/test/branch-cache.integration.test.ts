import * as assert from "assert";
import { mkdtemp, rename, rm, writeFile } from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { BranchCache, CacheOptions, repositoryCacheKey } from "../branch-cache";
import {
    BackgroundRefresh,
    BackgroundRefreshOptions,
    RepositoryProvider,
    ScheduleRefresh,
} from "../background-refresh";
import { affectsBackgroundSchedule } from "../config";
import { createRemoteRefresher } from "../remote-refresh";
import { runGit } from "../git-commands";
import { processRepositories } from "../process-repositories";
import { createPreflightSummary } from "../switch-preflight";
import { createRepositorySwitchPlans } from "../switch-plan";
import { determineDefaultBranch } from "../switch-to-default-branch";
import { ApiRepository, Ref, RefType } from "../types";

const DAY_MS = 86_400_000;

class MemoryMemento implements vscode.Memento {
    private readonly values = new Map<string, unknown>();

    keys(): readonly string[] {
        return [...this.values.keys()];
    }

    get<T>(key: string): T | undefined;
    get<T>(key: string, defaultValue: T): T;
    get<T>(key: string, defaultValue?: T): T | undefined {
        return (this.values.get(key) as T | undefined) ?? defaultValue;
    }

    async update(key: string, value: unknown): Promise<void> {
        if (value === undefined) {
            this.values.delete(key);
        } else {
            this.values.set(key, value);
        }
    }
}

/** Stands in for setTimeout so tests fire background ticks by hand. */
class FakeScheduler {
    tick?: () => void;
    scheduled = 0;
    disposed = 0;
    readonly delays: number[] = [];

    readonly schedule: ScheduleRefresh = (callback, delay) => {
        this.tick = callback;
        this.scheduled++;
        this.delays.push(delay);
        return {
            dispose: () => {
                this.disposed++;
                this.tick = undefined;
            },
        };
    };

    fire(): void {
        assert.ok(this.tick, "no background tick is pending");
        this.tick();
    }
}

suite("Branch cache and switching integration", function () {
    this.timeout(20_000);
    let tempRoot: string;
    let remotePath: string;
    let seedPath: string;
    let repoPaths: string[];
    let refQueries: number;
    let remoteFetches: number;
    let repositories: ApiRepository[];

    suiteSetup(async function () {
        this.timeout(20_000);
        tempRoot = await mkdtemp(path.join(os.tmpdir(), "multi-repo-switcher-"));
        remotePath = path.join(tempRoot, "remote.git");
        seedPath = path.join(tempRoot, "seed");
        await runGit(undefined, ["init", "--bare", remotePath]);
        await runGit(undefined, ["init", "-b", "main", seedPath]);
        await runGit(seedPath, ["config", "user.email", "integration@example.com"]);
        await runGit(seedPath, ["config", "user.name", "Integration Test"]);
        await writeFile(path.join(seedPath, "README.md"), "integration\n");
        await runGit(seedPath, ["add", "README.md"]);
        await runGit(seedPath, ["commit", "-m", "Initial commit"]);
        await runGit(seedPath, ["remote", "add", "origin", remotePath]);
        await runGit(seedPath, ["push", "-u", "origin", "main"]);
        await runGit(remotePath, ["symbolic-ref", "HEAD", "refs/heads/main"]);
        await runGit(seedPath, ["checkout", "-b", "feature/cache"]);
        await runGit(seedPath, ["push", "-u", "origin", "feature/cache"]);

        repoPaths = [path.join(tempRoot, "repo-one"), path.join(tempRoot, "repo-two")];
        for (const repoPath of repoPaths) {
            await runGit(undefined, ["clone", remotePath, repoPath]);
        }
        refQueries = 0;
        remoteFetches = 0;
        repositories = repoPaths.map(createRepository);
    });

    suiteTeardown(async () => {
        await rm(tempRoot, { recursive: true, force: true });
    });

    test("queries each repository once, persists refs, and refreshes on demand", async () => {
        const cache = new BranchCache(new MemoryMemento());
        const first = await cache.collect(repositories, {
            enabled: true,
            ttlMs: 300_000,
            now: 1_000,
        });
        assert.strictEqual(refQueries, 2);
        assert.ok(first.branches.has("main"));
        assert.ok(first.branches.has("feature/cache"));
        assert.ok(!first.branches.has("HEAD"));

        await cache.collect(repositories, {
            enabled: true,
            ttlMs: 300_000,
            now: 2_000,
        });
        assert.strictEqual(refQueries, 2, "fresh cache should avoid Git ref queries");

        await cache.collect(repositories, {
            enabled: true,
            ttlMs: 0,
            now: 2_000,
        });
        assert.strictEqual(refQueries, 4, "a zero TTL should always query Git refs");

        await runGit(repoPaths[0], ["branch", "new-local-branch"]);
        const refreshed = await cache.collect(repositories, {
            enabled: true,
            ttlMs: 300_000,
            forceRefresh: true,
            now: 3_000,
        });
        assert.strictEqual(refQueries, 6);
        assert.ok(refreshed.branches.has("new-local-branch"));
    });

    test("fetches only when a cache entry is refreshed and discovers remote branches", async () => {
        const cache = new BranchCache(new MemoryMemento());
        await cache.collect(repositories, { enabled: true, ttlMs: 300_000 });
        const fetchesBefore = remoteFetches;

        await runGit(seedPath, ["checkout", "-b", "feature/remote-refresh"]);
        await runGit(seedPath, ["push", "-u", "origin", "feature/remote-refresh"]);
        const stillCached = await cache.collect(repositories, {
            enabled: true,
            ttlMs: 300_000,
            refreshRemote: (repository) => repository.fetch({ remote: "origin" }),
        });
        assert.strictEqual(remoteFetches, fetchesBefore);
        assert.ok(!stillCached.branches.has("feature/remote-refresh"));

        const refreshed = await cache.collect(repositories, {
            enabled: true,
            ttlMs: 300_000,
            forceRefresh: true,
            refreshRemote: (repository) => repository.fetch({ remote: "origin" }),
        });
        assert.strictEqual(remoteFetches, fetchesBefore + repositories.length);
        assert.ok(refreshed.branches.has("feature/remote-refresh"));
        assert.deepStrictEqual(refreshed.remoteRefreshFailures, []);
    });

    test("background fetch updates persisted refs without making picker opens fetch", async () => {
        const state = new MemoryMemento();
        const cache = new BranchCache(state);
        const options = cacheOptions({
            intervalMs: 300_000,
            maxConcurrency: 1,
            refreshRemote: createRemoteRefresher("When Cache Expires"),
        });
        await cache.collect(repositories, options);
        await runGit(seedPath, ["branch", "feature/background"]);
        await runGit(seedPath, ["push", "origin", "feature/background"]);
        const { worker, scheduler, messages } = startWorker(cache, () => options);
        try {
            const before = remoteFetches;
            scheduler.fire();
            await waitUntil(() => scheduler.scheduled === 2);
            assert.deepStrictEqual(scheduler.delays, [300_000, 300_000]);
            assert.strictEqual(remoteFetches, before + repositories.length);
            const queries = refQueries;
            const catalog = await new BranchCache(state).collect(repositories, options);
            assert.ok(catalog.branches.has("feature/background"));
            assert.strictEqual(refQueries, queries);
            assert.strictEqual(remoteFetches, before + repositories.length);
            assert.deepStrictEqual(messages, []);

            // Never still refreshes local changes, without contacting origin.
            options.refreshRemote = createRemoteRefresher("Never");
            await runGit(repoPaths[0], ["branch", "background-local"]);
            scheduler.fire();
            await waitUntil(() => scheduler.scheduled === 3);
            assert.strictEqual(remoteFetches, before + repositories.length);
            assert.ok((await cache.collect(repositories, options)).branches.has("background-local"));

            options.intervalMs = 0;
            worker.configure();
            assert.strictEqual(scheduler.tick, undefined);
            options.intervalMs = 10_000;
            worker.configure();
            assert.ok(scheduler.tick);
            options.enabled = false;
            worker.configure();
            assert.strictEqual(scheduler.tick, undefined);
        } finally {
            worker.dispose();
        }
        assert.strictEqual(scheduler.tick, undefined);
    });

    test("background refresh does not overlap, retries failures, and cancels on disposal", async () => {
        const cache = new BranchCache(new MemoryMemento());
        await cache.collect(repositories, cacheOptions());
        const { gate, release } = createGate();
        let calls = 0;
        const { worker, scheduler, messages } = startWorker(cache, () => cacheOptions({
            refreshRemote: async () => {
                calls++;
                await gate;
                throw new Error("offline");
            },
        }));
        try {
            scheduler.fire();
            await waitUntil(() => calls === 2);
            scheduler.fire();
            assert.strictEqual(calls, 2);
            assert.strictEqual(scheduler.scheduled, 1, "no timer queued during slow fetch");
            release();
            await waitUntil(() => scheduler.scheduled === 2);
            assert.strictEqual(messages.length, 2);
            scheduler.fire();
            await waitUntil(() => scheduler.scheduled === 3);
            assert.strictEqual(calls, 4, "failed fetches are retried");
            assert.strictEqual(messages.length, 2, "an unchanged failure is not logged again");
            const lateTick = scheduler.tick!;
            worker.dispose();
            lateTick();
            assert.strictEqual(calls, 4);
            assert.ok(scheduler.disposed);
        } finally {
            release();
            worker.dispose();
        }
    });

    test("disposal during a background fetch preserves the cache and stops future runs", async () => {
        const cache = new BranchCache(new MemoryMemento());
        await cache.collect(repositories, cacheOptions({ now: 1_000 }));
        const remote = gatedRemote();
        const { worker, scheduler, messages } = startWorker(
            cache,
            () => cacheOptions({ refreshRemote: remote.refresh })
        );
        try {
            scheduler.fire();
            await waitUntil(() => remote.started === repositories.length);
            const before = refQueries;
            worker.dispose();
            remote.release();
            // Drain the asynchronous fetch continuations before inspecting storage.
            await delay(20);
            assert.strictEqual(refQueries, before);
            assert.strictEqual(scheduler.scheduled, 1);
            assert.deepStrictEqual(messages, [], "cancellation is silent");
            await cache.collect(repositories, cacheOptions({ now: 2_000 }));
            assert.strictEqual(refQueries, before, "the previous snapshot remains usable");
            await cache.collect(repositories, cacheOptions({ now: 86_402_000 }));
            assert.strictEqual(refQueries, before + repositories.length,
                "an expired snapshot still requires a full rebuild");
        } finally {
            remote.release();
            worker.dispose();
        }
    });

    test("honors cancellation instead of silently falling back to cached refs", async () => {
        const cache = new BranchCache(new MemoryMemento());
        await cache.collect(repositories, { enabled: true, ttlMs: 300_000 });
        const cancellation = new vscode.CancellationTokenSource();
        cancellation.cancel();

        await assert.rejects(
            cache.collect(repositories, {
                enabled: true,
                ttlMs: 300_000,
                forceRefresh: true,
                cancellationToken: cancellation.token,
            }),
            (error) => error instanceof vscode.CancellationError
        );
        cancellation.dispose();
    });

    test("preflight previews fallback and blocked repositories without changing branches", async () => {
        await runGit(repoPaths[0], ["branch", "partial-branch"]);
        await runGit(repoPaths[1], ["branch", "master"]);
        const cache = new BranchCache(new MemoryMemento());
        const catalog = await cache.collect(repositories, {
            enabled: false,
            ttlMs: 0,
        });
        await writeFile(path.join(repoPaths[1], "dirty.txt"), "dirty\n");

        const plans = await createRepositorySwitchPlans(
            repositories,
            "partial-branch",
            false,
            catalog
        );
        const summary = createPreflightSummary(plans);
        assert.deepStrictEqual(
            { ready: summary.ready, fallback: summary.fallback, blocked: summary.blocked },
            { ready: 1, fallback: 0, blocked: 1 }
        );
        assert.strictEqual(
            await runGit(repoPaths[0], ["branch", "--show-current"]),
            "main"
        );
        await rm(path.join(repoPaths[1], "dirty.txt"));

        const cleanPlans = await createRepositorySwitchPlans(
            repositories,
            "partial-branch",
            false,
            catalog
        );
        const cleanSummary = createPreflightSummary(cleanPlans);
        assert.deepStrictEqual(
            {
                ready: cleanSummary.ready,
                fallback: cleanSummary.fallback,
                blocked: cleanSummary.blocked,
            },
            { ready: 2, fallback: 1, blocked: 0 },
            JSON.stringify(cleanPlans.map((plan) => ({
                repository: plan.repositoryName,
                blocked: plan.blocked,
                message: plan.blockedMessage,
                reason: plan.reason,
            })))
        );
    });

    test("revalidates repository safety after preflight confirmation", async () => {
        const cache = new BranchCache(new MemoryMemento());
        const catalog = await cache.collect(repositories, {
            enabled: false,
            ttlMs: 0,
        });
        const plans = await createRepositorySwitchPlans(
            repositories,
            "main",
            false,
            catalog
        );
        await writeFile(path.join(repoPaths[1], "changed-after-preflight.txt"), "dirty\n");

        const results = await processRepositories(
            repositories,
            "main",
            false,
            undefined,
            catalog,
            plans
        );
        assert.ok(
            results.some((result) => result.includes("changed after preflight")),
            results.join("\n")
        );
        await rm(path.join(repoPaths[1], "changed-after-preflight.txt"));
    });

    test("rechecks refs that appeared after a cached catalog was built", async () => {
        const cache = new BranchCache(new MemoryMemento());
        const catalog = await cache.collect(repositories, {
            enabled: false,
            ttlMs: 0,
        });
        await runGit(repoPaths[0], [
            "update-ref",
            "refs/remotes/origin/late-remote-ref",
            "refs/remotes/origin/main",
        ]);

        const [plan] = await createRepositorySwitchPlans(
            [repositories[0]],
            "late-remote-ref",
            false,
            catalog
        );

        assert.strictEqual(plan.source, "remote");
        assert.strictEqual(plan.reason, "selected-remote");
        assert.ok(
            catalog.byRepository.values().next().value?.remote.has("late-remote-ref")
        );
    });

    test("switches from cached remote-tracking refs without remote access", async () => {
        const state = new MemoryMemento();
        const cache = new BranchCache(state);
        const catalog = await cache.collect(repositories, {
            enabled: true,
            ttlMs: 300_000,
        });
        const offlineRemote = `${remotePath}.offline`;
        await rename(remotePath, offlineRemote);

        const results = await processRepositories(
            repositories,
            "feature/cache",
            false,
            undefined,
            catalog
        );

        assert.ok(results.every((result) => result.startsWith("✅")), results.join("\n"));
        for (const repoPath of repoPaths) {
            assert.strictEqual(
                await runGit(repoPath, ["branch", "--show-current"]),
                "feature/cache"
            );
        }
        await cache.persistLocalChanges(catalog);
        const queriesBeforeReload = refQueries;
        const reloaded = await new BranchCache(state).collect(repositories, {
            enabled: true,
            ttlMs: 300_000,
        });
        assert.strictEqual(refQueries, queriesBeforeReload);
        for (const snapshot of reloaded.byRepository.values()) {
            assert.ok(snapshot.local.has("feature/cache"));
        }
        remotePath = offlineRemote;
    });

    test("resolves the remote default branch using only local refs", async () => {
        const resolved = await determineDefaultBranch(repoPaths[0]);
        assert.strictEqual(resolved.name, "main");
        assert.strictEqual(resolved.source, "local");
    });

    test("falls back to stale entries when a refresh fails", async () => {
        const cache = new BranchCache(new MemoryMemento());
        await cache.collect(repositories, { enabled: true, ttlMs: 300_000 });
        const unavailable = repositories.map((repository) => ({
            ...repository,
            getRefs: async () => {
                throw new Error("temporary Git failure");
            },
        }));

        const fallback = await cache.collect(unavailable, {
            enabled: true,
            ttlMs: 300_000,
            forceRefresh: true,
        });
        assert.deepStrictEqual(
            fallback.staleRepositories.sort(),
            ["repo-one", "repo-two"]
        );
        assert.ok(fallback.branches.has("main"));
    });

    test("keeps local refs usable when remote refresh fails", async () => {
        const cache = new BranchCache(new MemoryMemento());
        const unavailable = repositories.map((repository) => ({
            ...repository,
            fetch: async () => {
                throw new Error("origin is offline");
            },
        }));
        const catalog = await cache.collect(unavailable, {
            enabled: true,
            ttlMs: 300_000,
            refreshRemote: (repository) => repository.fetch({ remote: "origin" }),
        });

        assert.strictEqual(catalog.remoteRefreshFailures.length, 2);
        assert.ok(catalog.branches.has("main"));
        assert.deepStrictEqual(catalog.staleRepositories, []);
    });

    for (const [cancelled, survivor] of [["first", "second"], ["second", "first"]] as const) {
        test(`a shared ref load survives when the ${cancelled} caller to join it is cancelled`, async () => {
            const cache = new BranchCache(new MemoryMemento());
            const remote = gatedRemote();
            const sources = {
                first: new vscode.CancellationTokenSource(),
                second: new vscode.CancellationTokenSource(),
            };
            try {
                const first = cache.collect(repositories, forcedLoad(remote, sources.first.token));
                await waitUntil(() => remote.started === repositories.length);
                const second = cache.collect(repositories, forcedLoad(remote, sources.second.token));
                const runs = { first, second };

                sources[cancelled].cancel();
                remote.release();

                await assert.rejects(
                    runs[cancelled],
                    (error) => error instanceof vscode.CancellationError
                );
                assert.ok((await runs[survivor]).branches.has("main"));
            } finally {
                remote.release();
                sources.first.dispose();
                sources.second.dispose();
            }
        });
    }

    test("a load abandoned by every caller is not handed to the next one", async () => {
        const cache = new BranchCache(new MemoryMemento());
        const remote = gatedRemote();
        const abandoned = new vscode.CancellationTokenSource();
        try {
            const abandonedRun = cache.collect(repositories, forcedLoad(remote, abandoned.token));
            await waitUntil(() => remote.started === repositories.length);

            // The only caller walks away, then a new refresh arrives before the
            // cancelled load has finished unwinding.
            abandoned.cancel();
            const rejoined = cache.collect(repositories, forcedLoad(remote));
            remote.release();

            await assert.rejects(
                abandonedRun,
                (error) => error instanceof vscode.CancellationError
            );
            assert.ok(
                (await rejoined).branches.has("main"),
                "a caller must never inherit an already-cancelled load"
            );
        } finally {
            remote.release();
            abandoned.dispose();
        }
    });

    // The refresh that lands between building a catalog and persisting a switch
    // may carry a later, earlier or identical clock; only its revision may decide.
    for (const [label, catalogNow, refreshNow] of [
        ["a background refresh added afterwards", 1_000, 2_000],
        ["a slower refresh that started earlier", 5_000, 1_000],
        ["a refresh written within the same millisecond", 7_000, 7_000],
    ] as const) {
        test(`persisting a switch keeps refs from ${label}`, async () => {
            const state = new MemoryMemento();
            const cache = new BranchCache(state);
            const background = `background-${catalogNow}-${refreshNow}`;
            const created = `switch-${catalogNow}-${refreshNow}`;
            const catalog = await cache.collect(repositories, cacheOptions({ now: catalogNow }));
            await runGit(repoPaths[0], ["branch", background]);
            await new BranchCache(state).collect(
                repositories,
                cacheOptions({ forceRefresh: true, now: refreshNow })
            );
            const key = repositoryCacheKey(repoPaths[0]);
            catalog.byRepository.get(key)!.local.add(created);

            await cache.persistLocalChanges(catalog);

            const reloaded = await new BranchCache(state).collect(
                repositories,
                cacheOptions({ now: catalogNow + 500 })
            );
            assert.ok(
                reloaded.branches.has(background),
                "refs written since the catalog was built must survive the post-switch persist"
            );
            assert.ok(reloaded.branches.has(created));
        });
    }

    test("reconfiguring keeps an in-flight background refresh alive", async () => {
        const cache = new BranchCache(new MemoryMemento());
        await cache.collect(repositories, cacheOptions({ now: 1_000 }));
        await runGit(repoPaths[0], ["branch", "survives-reconfigure"]);
        const remote = gatedRemote();
        const { worker, scheduler, messages } = startWorker(
            cache,
            () => cacheOptions({ refreshRemote: remote.refresh })
        );
        try {
            scheduler.fire();
            await waitUntil(() => remote.started === repositories.length);

            worker.configure();
            remote.release();
            await waitUntil(() => scheduler.scheduled === 2);

            assert.deepStrictEqual(messages, []);
            const catalog = await cache.collect(repositories, cacheOptions({ now: 2_000 }));
            assert.ok(
                catalog.branches.has("survives-reconfigure"),
                "a settings change must not discard the running refresh"
            );
        } finally {
            remote.release();
            worker.dispose();
        }
    });

    test("only schedule settings restart the background timer", () => {
        const affects = (changed: string) => affectsBackgroundSchedule({
            affectsConfiguration: (section: string) => section === changed,
        });
        assert.ok(affects("multiRepoBranchSwitcher.cache.enabled"));
        assert.ok(affects("multiRepoBranchSwitcher.cache.backgroundRefreshIntervalSeconds"));
        assert.strictEqual(affects("multiRepoBranchSwitcher.defaultBranchName"), false);
        assert.strictEqual(affects("multiRepoBranchSwitcher.prune.cutoffDays"), false);
        assert.strictEqual(affects("multiRepoBranchSwitcher.cache.ttlSeconds"), false);
    });

    test("reports when Git repository discovery fails, once per outage", async () => {
        const cache = new BranchCache(new MemoryMemento());
        let available = false;
        const { worker, scheduler, messages } = startWorker(cache, cacheOptions, async (reportFailure) => {
            if (available) {
                return repositories;
            }
            reportFailure("Unable to load Git extension");
            return undefined;
        });
        try {
            scheduler.fire();
            await waitUntil(() => scheduler.scheduled === 2);
            assert.deepStrictEqual(
                messages,
                ["Background refresh skipped: Unable to load Git extension"]
            );

            scheduler.fire();
            await waitUntil(() => scheduler.scheduled === 3);
            assert.strictEqual(messages.length, 1, "an ongoing outage is logged once");

            available = true;
            scheduler.fire();
            await waitUntil(() => scheduler.scheduled === 4);
            assert.strictEqual(messages.length, 2);
            assert.match(messages[1], /resumed/);
        } finally {
            worker.dispose();
        }
    });

    test("reads a cache written before entries carried revisions", async () => {
        const state = new MemoryMemento();
        const key = repositoryCacheKey(repoPaths[0]);
        // Exactly the shape 0.3.1 persisted: no nextRevision, no entry revision.
        await state.update("branchCache.v1", {
            version: 1,
            repositories: {
                [key]: {
                    root: repoPaths[0],
                    updatedAt: 1_000,
                    local: ["main"],
                    remote: ["main"],
                },
            },
        });
        const cache = new BranchCache(state);

        const catalog = await cache.collect([repositories[0]], cacheOptions({ now: 2_000 }));

        assert.ok(catalog.branches.has("main"));
        assert.strictEqual(catalog.repositoryRevision.get(key), 0);
        catalog.byRepository.get(key)!.local.add("after-migration");
        await cache.persistLocalChanges(catalog);
        const reloaded = await new BranchCache(state).collect(
            [repositories[0]],
            cacheOptions({ now: 2_500 })
        );
        assert.ok(reloaded.branches.has("after-migration"));
    });

    function createRepository(repoPath: string): ApiRepository {
        return {
            rootUri: { fsPath: repoPath },
            state: {
                HEAD: undefined,
                remotes: [{ name: "origin", fetchUrl: remotePath }],
            },
            fetch: async () => {
                remoteFetches++;
                await runGit(repoPath, ["fetch", "origin"]);
            },
            pull: async () => undefined,
            getRefs: async () => {
                refQueries++;
                const output = await runGit(repoPath, [
                    "for-each-ref",
                    "--format=%(refname)|%(objectname)",
                    "refs/heads",
                    "refs/remotes/origin",
                ]);
                return output.split("\n").filter(Boolean).map(parseRef);
            },
        };
    }

    /** Cached for a day; background workers built from it tick every 100 ms. */
    function cacheOptions(extra: Partial<BackgroundRefreshOptions> = {}): BackgroundRefreshOptions {
        return { enabled: true, ttlMs: DAY_MS, intervalMs: 100, ...extra };
    }

    /** A forced refresh that blocks inside the remote step until released. */
    function forcedLoad(
        remote: ReturnType<typeof gatedRemote>,
        cancellationToken?: vscode.CancellationToken
    ): CacheOptions {
        return {
            enabled: true,
            ttlMs: 0,
            forceRefresh: true,
            refreshRemote: remote.refresh,
            cancellationToken,
        };
    }

    function startWorker(
        cache: BranchCache,
        options: () => BackgroundRefreshOptions,
        provider: RepositoryProvider = async () => repositories
    ) {
        const scheduler = new FakeScheduler();
        const messages: string[] = [];
        const worker = new BackgroundRefresh(
            cache,
            provider,
            options,
            (message) => messages.push(message),
            scheduler.schedule
        );
        return { worker, scheduler, messages };
    }
});

/** A remote step that blocks until released and counts the repositories that reached it. */
function gatedRemote() {
    const { gate, release } = createGate();
    const remote = {
        started: 0,
        release,
        refresh: async () => {
            remote.started++;
            await gate;
        },
    };
    return remote;
}

function createGate(): { gate: Promise<void>; release: () => void } {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    return { gate, release };
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(condition: () => boolean): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (!condition()) {
        assert.ok(Date.now() < deadline, "condition was not met within 10 s");
        await delay(10);
    }
}

function parseRef(line: string): Ref {
    const [fullName, commit] = line.split("|");
    if (fullName.startsWith("refs/heads/")) {
        return {
            name: fullName.slice("refs/heads/".length),
            commit,
            type: RefType.Head,
        };
    }
    return {
        name: fullName.slice("refs/remotes/".length),
        commit,
        remote: "origin",
        type: RefType.RemoteHead,
    };
}
