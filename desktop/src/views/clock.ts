/** Calls `tick` now and on every minute boundary; returns the stop. */
export function everyMinute(tick: (now: Date) => void, now: () => Date = () => new Date()): () => void {
    let timer = 0;
    const run = () => {
        const date = now();
        tick(date);
        const untilMinute = 60_000 - (date.getSeconds() * 1000 + date.getMilliseconds());
        timer = window.setTimeout(run, untilMinute);
    };
    run();
    return () => window.clearTimeout(timer);
}
