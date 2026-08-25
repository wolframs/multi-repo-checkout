export async function mapWithConcurrency<T, R>(
    values: readonly T[],
    concurrency: number,
    operation: (value: T, index: number) => Promise<R>
): Promise<R[]> {
    const results = new Array<R>(values.length);
    let nextIndex = 0;

    async function worker(): Promise<void> {
        while (true) {
            const index = nextIndex++;
            if (index >= values.length) {
                return;
            }
            results[index] = await operation(values[index], index);
        }
    }

    const workerCount = Math.min(Math.max(1, concurrency), values.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
}
