import { afterEach, describe, expect, it, vi } from "vitest";
import { ReplayViewHandoff, type ReplayPreparedView } from "./replay-view-handoff";
const ready = (requestId: number): ReplayPreparedView => ({ready:true,requestId,transition:"cut",preparationMs:10});
afterEach(()=>vi.useRealTimers());
describe("prepared Replay intent",()=>{
  it("coalesces scrub updates and prepares only the released destination",async()=>{
    vi.useFakeTimers();const changed=vi.fn(), prepare=vi.fn(async ({requestId})=>ready(requestId)), commit=vi.fn((_destination: number)=>true);
    const handoff=new ReplayViewHandoff<number>(changed);
    for(const d of [12000,9500,11000,9700,9850]) handoff.request(d,prepare,commit);
    expect(handoff.pending?.destination).toBe(9850);expect(prepare).not.toHaveBeenCalled();
    handoff.flush();await vi.runAllTimersAsync();expect(prepare).toHaveBeenCalledTimes(1);expect(commit.mock.calls[0][0]).toBe(9850);expect(handoff.pending).toBeNull();
  });
  it("ignores a late completion after another destination replaces it",async()=>{
    vi.useFakeTimers();const commits:number[]=[];let first!:(v:ReplayPreparedView)=>void;let firstId=0;
    const h=new ReplayViewHandoff<number>(()=>{});
    h.request(100,({requestId})=>{firstId=requestId;return new Promise(r=>{first=r;});},d=>{commits.push(d);return true;});h.flush();await Promise.resolve();
    h.request(200,async({requestId})=>ready(requestId),d=>{commits.push(d);return true;});h.flush();await vi.runAllTimersAsync();
    first(ready(firstId));await Promise.resolve();expect(commits).toEqual([200]);
  });
  it("does not own Play/Pause intent and reads it at commit, not selection",async()=>{
    vi.useFakeTimers();let playing=true,atCommit=true;const h=new ReplayViewHandoff<number>(()=>{});
    h.request(9850,async({requestId})=>ready(requestId),()=>{atCommit=playing;return true;});playing=false;
    await vi.runAllTimersAsync();expect(atCommit).toBe(false);
  });
  it("cancels work on free camera or unmount without committing",async()=>{
    vi.useFakeTimers();const commit=vi.fn((_destination: number)=>true);const h=new ReplayViewHandoff<number>(()=>{});
    h.request(1,async({requestId})=>ready(requestId),commit);h.cancel();await vi.runAllTimersAsync();expect(commit).not.toHaveBeenCalled();
  });
  it("keeps a failed destination explicit instead of treating the outgoing scene as success",async()=>{
    vi.useFakeTimers();const h=new ReplayViewHandoff<number>(()=>{});const commit=vi.fn((_destination: number)=>true);
    h.request(9850,async({requestId})=>({...ready(requestId),ready:false,reason:"timeout"}),commit);
    await vi.runAllTimersAsync();expect(h.pending).toMatchObject({destination:9850,phase:"blocked",reason:"timeout"});expect(commit).not.toHaveBeenCalled();
  });
  it("rejects a result from a different request and handles preparation exceptions",async()=>{
    vi.useFakeTimers();const h=new ReplayViewHandoff<number>(()=>{});const commit=vi.fn((_destination: number)=>true);
    h.request(1,async()=>ready(-1),commit);await vi.runAllTimersAsync();expect(h.pending?.phase).toBe("blocked");expect(commit).not.toHaveBeenCalled();
    h.request(2,async()=>{throw new Error("provider");},commit);await vi.runAllTimersAsync();expect(h.pending?.phase).toBe("blocked");
  });
});
