import * as assert from 'assert';

suite('Prune Stale Branches Test Suite', () => {
    test('Protected branch pattern matching', () => {
        const protectedPatterns = ["^(main|master|develop)$"];
        const protectedRegexes = protectedPatterns.map((pattern) => new RegExp(pattern));

        // Test protected branches
        assert.strictEqual(protectedRegexes[0].test("main"), true);
        assert.strictEqual(protectedRegexes[0].test("master"), true);
        assert.strictEqual(protectedRegexes[0].test("develop"), true);

        // Test non-protected branches
        assert.strictEqual(protectedRegexes[0].test("feature/test"), false);
        assert.strictEqual(protectedRegexes[0].test("main-old"), false);
        assert.strictEqual(protectedRegexes[0].test("main/feature"), false);
    });

    test('Date cutoff calculation', () => {
        const cutoffDays = 14;
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - cutoffDays);

        const oldDate = new Date();
        oldDate.setDate(oldDate.getDate() - 20);
        assert.strictEqual(oldDate < cutoffDate, true, "Old date should be before cutoff");

        const recentDate = new Date();
        recentDate.setDate(recentDate.getDate() - 5);
        assert.strictEqual(recentDate < cutoffDate, false, "Recent date should be after cutoff");
    });

    test('Branch filtering logic - protected branches are skipped', () => {
        const protectedPatterns = ["^(main|master|develop)$", "^release/.*"];
        const protectedRegexes = protectedPatterns.map((pattern) => new RegExp(pattern));

        const branches = [
            { name: "main", lastCommitDate: new Date("2020-01-01") },
            { name: "master", lastCommitDate: new Date("2020-01-01") },
            { name: "develop", lastCommitDate: new Date("2020-01-01") },
            { name: "release/v1.0", lastCommitDate: new Date("2020-01-01") },
            { name: "feature/old-branch", lastCommitDate: new Date("2020-01-01") },
        ];

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 14);

        const eligibleForDeletion = branches.filter((branch) => {
            const isProtected = protectedRegexes.some((regex) => regex.test(branch.name));
            return !isProtected && branch.lastCommitDate < cutoffDate;
        });

        // Only feature/old-branch should be eligible (assuming it's older than cutoff)
        assert.strictEqual(eligibleForDeletion.length, 1);
        assert.strictEqual(eligibleForDeletion[0].name, "feature/old-branch");
    });
});

