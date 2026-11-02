// openDesign is limited to 10 calls per 10 s per app. A get_page uses one and an apply two (edit, then
// re-read), so a quick run of edits hits it: wait for room in the window instead of failing.
const WINDOW_MS = 10_000;
const MAX_CALLS = 9;

const calls : Array<number> = [];

export async function limited<T>(fn : () => Promise<T>) : Promise<T> {
    for(;;) {
        const t = Date.now();
        while(calls.length && t - calls[0]! >= WINDOW_MS) calls.shift();
        if(calls.length < MAX_CALLS) break;
        await new Promise(res => setTimeout(res, calls[0]! + WINDOW_MS - t + 50));
    }
    calls.push(Date.now());
    return fn();
}
