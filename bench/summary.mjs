// Prints one or more benchmark files as compact tables, so a run can be read next to another one:
//   node bench/summary.mjs docs/benchmarks/rally-baseline.json docs/benchmarks/rally-latest.json
import { readFileSync } from 'node:fs';

const files = process.argv.slice(2);
const sets = files.map((file) => JSON.parse(readFileSync(file, 'utf8')));
const percent = (part, whole) => (whole ? `${((100 * part) / whole).toFixed(1)}%`.padStart(6) : '     –');

console.log('FLY-BY: hit rate by how close the ball really came (1× = ball and paddle just touch)');
for (const set of sets) {
  for (const f of set.flyBy) {
    console.log(
      f.mode.padEnd(10),
      `${String(f.fps).padStart(3)} fps${f.jitter ? ' ±35%' : '     '}`,
      f.bands.map((band) => `≤${band.upTo}×${percent(band.hits, band.trials)}`).join('  '),
      ` beyond 2×: ${f.falsePositives}/${f.trials}`,
      ` furthest ${f.furthestHit.toFixed(2)}×`,
    );
  }
}

if (sets.some((set) => set.drill)) {
  console.log('\nSERVE DRILL: identical serves and aiming errors in every version; hit rate by how close the attempt truly came');
  console.log(`${''.padEnd(22)}    all    | touching  1–1.3×  1.3–1.6×  1.6–2×  beyond 2× | near-miss rescue (1–1.6×) | hits over the net`);
  for (const set of sets) {
    for (const d of set.drill ?? []) {
      const b = d.bands;
      console.log(
        `${d.mode} · ${d.skill}`.padEnd(22),
        percent(d.hits, d.serves),
        '  |',
        b ? b.map((band) => percent(band.hits, band.trials).padStart(8)).join(' ') : ' (no bands)',
        ' |',
        b ? `${percent(b[1].hits + b[2].hits, b[1].trials + b[2].trials)} of ${String(b[1].trials + b[2].trials).padStart(3)}`.padStart(22) : '',
        '   |',
        percent(d.returnsOver, d.hits),
      );
    }
  }
}

console.log(`\nRALLY: simulated player against the stage agent, ${sets[0].rallySeeds ?? 6} seeds × ${sets[0].rallySeconds ?? 90} s`);
console.log(`${'scenario'.padEnd(42)} rallies hits/r longest | player  nearMiss | overNet |    cpu | dbl | ended by: pMiss pFault cMiss cFault |   µs`);
for (const set of sets) {
  for (const [key, r] of Object.entries(set.rally)) {
    console.log(
      key.padEnd(42),
      String(r.rallies).padStart(6),
      r.averageHits.toFixed(2).padStart(6),
      String(r.longestRally).padStart(7),
      '|',
      percent(r.playerHits, r.playerAttempts),
      percent(r.playerNearMisses, r.playerAttempts).padStart(9),
      '|',
      percent(r.playerReturnsOver, r.playerHits).padStart(7),
      '|',
      percent(r.cpuHits, r.cpuAttempts),
      '|',
      String(r.doubleHits).padStart(3),
      '|',
      String(r.endings.playerMiss).padStart(15),
      String(r.endings.playerFault).padStart(6),
      String(r.endings.cpuMiss).padStart(5),
      String(r.endings.cpuFault).padStart(6),
      '|',
      r.updateMicros.toFixed(1).padStart(5),
    );
  }
}
