import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';
import { SceneController } from '../src/scene/SceneController';
import { computeLayout } from '../src/scene/StageProps';
import { combine, runFlyBy, runRally, runServeDrill, type AssistLabel, type DrillResult, type FlyByResult, type RallyResult, type Skill } from './rallyHarness';

/**
 * `yarn bench:rally`: runs the fixed fly-by, serve-drill and rally scenarios
 * and writes the numbers to docs/benchmarks/rally-latest.json. On the
 * original scene (no assistance modes) it measures that one behaviour,
 * labelled `baseline`.
 */

/** Simulated play per rally scenario: one run of this many seconds for each seed. */
const RALLY_SECONDS = 300;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const hasModes = typeof (new SceneController(computeLayout(1200)) as unknown as { setAssist?: unknown }).setAssist === 'function';
const MODES: AssistLabel[] = hasModes ? ['precision', 'natural', 'cinematic'] : ['baseline'];
const SKILLS: Skill[] = ['steady', 'average', 'sloppy', 'novice', 'absent'];
const SEEDS = [1, 2, 3, 4, 5, 6];

const percent = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : '–');

function describeFlyBy(result: FlyByResult): string {
  const row = (bands: FlyByResult['bands']) => bands.map((band) => `≤${band.upTo}×: ${percent(band.hits, band.trials)} of ${band.trials}`).join('   ');
  return [
    `${result.mode.padEnd(10)} ${String(result.fps).padStart(3)} fps${result.jitter ? ' ±35%' : '     '}  ${row(result.bands)}`,
    `${' '.repeat(26)}closing > 600 u/s: ${row(result.fastBands)}`,
    `${' '.repeat(26)}false positives (hit beyond 2×): ${result.falsePositives}   furthest hit: ${result.furthestHit.toFixed(2)}×`,
  ].join('\n');
}

function describeRally(label: string, r: RallyResult): string {
  return (
    `${label.padEnd(34)} rallies ${String(r.rallies).padStart(4)}  hits/rally ${r.averageHits.toFixed(2).padStart(5)}  longest ${String(r.longestRally).padStart(3)}  ` +
    `player ${percent(r.playerHits, r.playerAttempts).padStart(6)} of ${String(r.playerAttempts).padStart(4)}  near-miss ${percent(r.playerNearMisses, r.playerAttempts).padStart(6)}  ` +
    `serve ${percent(r.serveHits, r.serveAttempts).padStart(6)} (near-miss ${percent(r.serveNearMisses, r.serveAttempts).padStart(6)})  ` +
    `over net ${percent(r.playerReturnsOver, r.playerHits).padStart(6)}  cpu ${percent(r.cpuHits, r.cpuAttempts).padStart(6)} of ${String(r.cpuAttempts).padStart(4)}  double ${r.doubleHits}  ` +
    `ended by: player miss ${r.endings.playerMiss} / player fault ${r.endings.playerFault} / cpu miss ${r.endings.cpuMiss} / cpu fault ${r.endings.cpuFault}  ${r.updateMicros.toFixed(1)} µs`
  );
}

it('rally benchmark', () => {
  const lines: string[] = [];
  const flyBy: FlyByResult[] = [];
  const rally: Record<string, RallyResult> = {};

  lines.push('FLY-BY: hit rate by true miss distance (1× = ball and paddle disc just touch)');
  for (const mode of MODES) {
    for (const [fps, jitter] of [[60, false], [30, false], [120, false], [60, true]] as const) {
      const result = runFlyBy({ mode, fps, trials: 6000, seed: 20261008, jitter });
      flyBy.push(result);
      lines.push(describeFlyBy(result));
    }
  }

  lines.push('', 'SERVE DRILL: 600 identical serves per player, each with the same aiming error in every version', '  hit rate by how close the attempt truly came (in touching distances), and how many of the hits crossed the net');
  const drill: DrillResult[] = [];
  for (const mode of MODES) {
    for (const skill of ['steady', 'average', 'sloppy', 'novice'] as const) {
      const d = runServeDrill({ mode, skill, serves: 600, seed: 5, fps: 60 });
      drill.push(d);
      lines.push(
        `${`${mode} · ${skill}`.padEnd(22)} hit ${percent(d.hits, d.serves).padStart(6)}   ` +
          d.bands.map((band) => `${band.upTo > 50 ? 'beyond' : `≤${band.upTo}×`}: ${percent(band.hits, band.trials)} of ${band.trials}`).join('   ') +
          `   returned over the net ${percent(d.returnsOver, d.hits).padStart(6)}`,
      );
    }
  }

  lines.push('', `RALLY: simulated player (left) against the stage agent (right), ${SEEDS.length} seeds × ${RALLY_SECONDS} s`);
  for (const mode of MODES) {
    for (const skill of SKILLS) {
      const key = `${mode} · ${skill} · 60 fps`;
      rally[key] = combine(SEEDS.map((seed) => runRally({ mode, skill, seed, seconds: RALLY_SECONDS, fps: 60 })));
      lines.push(describeRally(key, rally[key]));
    }
    for (const [label, options] of [
      ['30 fps', { fps: 30 }],
      ['120 fps', { fps: 120 }],
      ['60 fps ±35%', { fps: 60, jitter: true }],
      ['60 fps, 15 Hz camera', { fps: 60, cameraHz: 15 }],
    ] as const) {
      const key = `${mode} · average · ${label}`;
      rally[key] = combine(SEEDS.map((seed) => runRally({ mode, skill: 'average', seed, seconds: RALLY_SECONDS, ...options })));
      lines.push(describeRally(key, rally[key]));
    }
  }

  const report = lines.join('\n');
  console.log(`\n${report}\n`);
  const out = join(root, 'docs', 'benchmarks');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'rally-latest.json'), `${JSON.stringify({ modes: MODES, rallySeeds: SEEDS.length, rallySeconds: RALLY_SECONDS, flyBy, drill, rally }, null, 1)}\n`);
  writeFileSync(join(out, 'rally-latest.txt'), `${report}\n`);
});
