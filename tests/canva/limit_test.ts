import { assertEquals } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import { limited } from "../../canva/limit.ts";

Deno.test("limited holds the 10th call in 10 s until the window has room", async () => {
    using time = new FakeTime();
    const done : Array<number> = [];
    const all = Array.from({ length: 10 }, (_, i) => limited(() => Promise.resolve(done.push(i))));
    await time.tickAsync(0);
    assertEquals(done.length, 9);
    await time.tickAsync(10_100);
    await Promise.all(all);
    assertEquals(done.length, 10);
});
