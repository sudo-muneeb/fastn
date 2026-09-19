import fs from 'node:fs';
import path from 'node:path';

/** Tiny collection store: Map per collection, optional debounced JSON persistence. */
export class Store {
  constructor(file = null, seedFile = null) {
    this.file = file;
    this.cols = new Map();
    this.timer = null;
    const source = file && fs.existsSync(file) ? file : seedFile && fs.existsSync(seedFile) ? seedFile : null;
    if (source) {
      const raw = JSON.parse(fs.readFileSync(source, 'utf8'));
      for (const [name, entries] of Object.entries(raw)) this.cols.set(name, new Map(entries));
    }
  }
  col(name) {
    if (!this.cols.has(name)) this.cols.set(name, new Map());
    return this.cols.get(name);
  }
  has(name, id) { return this.col(name).has(id); }
  get(name, id) { return this.col(name).get(id); }
  set(name, id, doc) { this.col(name).set(id, doc); this.#schedule(); }
  delete(name, id) { this.col(name).delete(id); this.#schedule(); }
  values(name) { return [...this.col(name).values()]; }
  clear(name) { this.col(name).clear(); this.#schedule(); }

  #schedule() {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 250);
    this.timer.unref?.();
  }
  flush() {
    if (!this.file) return;
    const out = {};
    for (const [name, m] of this.cols) out[name] = [...m.entries()];
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(out));
    fs.renameSync(tmp, this.file);
  }
}
