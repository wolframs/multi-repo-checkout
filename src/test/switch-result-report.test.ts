import * as assert from "assert";
import {
    countSwitchResults,
    formatSwitchResultSummary,
    ResultOutput,
    showSwitchResultNotification,
} from "../switch-result-report";

suite("Switch result reporting", () => {
    const results = [
        "✅ repo-one: Switched branches",
        "✅ repo-two: Switched branches",
        "⚠️ repo-three: Dirty – skipped",
        "❌ repo-four: Checkout failed",
    ];

    test("builds a compact status summary", () => {
        assert.deepStrictEqual(countSwitchResults(results), {
            succeeded: 2,
            skipped: 1,
            failed: 1,
        });
        assert.strictEqual(
            formatSwitchResultSummary(results),
            "2 succeeded · 1 skipped · 1 failed"
        );
        assert.strictEqual(
            formatSwitchResultSummary([]),
            "No repositories processed"
        );
    });

    test("writes one result per line and opens details on request", async () => {
        const output = new MemoryResultOutput();
        let message = "";

        await showSwitchResultNotification(
            "Checkouts complete",
            results,
            output,
            async (presentedMessage, options, item) => {
                message = presentedMessage;
                assert.strictEqual(options.modal, false);
                return item;
            }
        );

        assert.strictEqual(
            message,
            "Checkouts complete: 2 succeeded · 1 skipped · 1 failed"
        );
        assert.deepStrictEqual(output.lines, [
            "Checkouts complete",
            "2 succeeded · 1 skipped · 1 failed",
            "",
            ...results,
        ]);
        assert.strictEqual(output.showCount, 1);
    });

    test("keeps the Output channel hidden when details are dismissed", async () => {
        const output = new MemoryResultOutput();
        await showSwitchResultNotification(
            "Default branch switch complete",
            results,
            output,
            async () => undefined
        );
        assert.strictEqual(output.showCount, 0);
    });
});

class MemoryResultOutput implements ResultOutput {
    readonly lines: string[] = [];
    showCount = 0;

    clear(): void {
        this.lines.length = 0;
    }

    appendLine(value: string): void {
        this.lines.push(value);
    }

    show(): void {
        this.showCount++;
    }
}
