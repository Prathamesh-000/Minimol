/** Unit-test transport: reliable ordered delivery unless a test explicitly faults it. */
export function memoryLink() {
  const ends = [0, 1].map(index => ({
    readyState: 'open', bufferedAmount: 0, frames: [], events: null, mutate: null,
    send(frame) {
      if (this.readyState !== 'open') throw new Error('closed');
      this.frames.push(frame.slice(0)); this.bufferedAmount += frame.byteLength;
      const changed = this.mutate ? this.mutate(frame.slice(0)) : frame.slice(0);
      queueMicrotask(() => {
        this.bufferedAmount -= frame.byteLength; this.events?.writable();
        if (changed && ends[1 - index].readyState === 'open') ends[1 - index].events?.message(changed);
      });
    },
    subscribe(events) { this.events = events; return () => { this.events = null; }; },
    close(reason) {
      if (this.readyState === 'closed') return;
      this.readyState = 'closed';
      queueMicrotask(() => { this.events?.close(reason); ends[1 - index].readyState = 'closed'; ends[1 - index].events?.close(reason); });
    },
  }));
  return ends;
}
