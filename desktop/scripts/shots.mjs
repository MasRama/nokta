// Screenshots of the UI in a plain browser, for checking it without Windows:
// builds, serves dist with `vite preview`, shoots each scene with system
// Chrome at 1x and 1.5x, and stops the server.
//
//   node scripts/shots.mjs <out-dir> [scene...]
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';

const out = resolve(process.argv[2] ?? 'shots');
const scenes = process.argv.length > 3 ? process.argv.slice(3) : ['idle', 'home', 'glass', 'paper', 'custom', 'player', 'player-open', 'volume', 'charging', 'call', 'call-player'];
// The window's size for the default config (desktop/src-tauri/src/layout.rs).
const WIDTH = 500;
const HEIGHT = 452;
const chrome = process.env.CHROME ?? 'google-chrome';

function freePort() {
    return new Promise((done) => {
        const server = createServer();
        server.listen(0, () => {
            const { port } = server.address();
            server.close(() => done(port));
        });
    });
}

async function waitFor(url) {
    for (let i = 0; i < 100; i++) {
        try {
            if ((await fetch(url)).ok) return;
        } catch {
            // not up yet
        }
        await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error(`${url} did not come up`);
}

mkdirSync(out, { recursive: true });
const build = spawnSync('npx', ['vite', 'build', '--logLevel', 'warn'], { stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);

const port = await freePort();
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
try {
    await waitFor(`http://localhost:${port}/`);
    for (const scene of scenes) {
        for (const scale of [1, 1.5]) {
            const file = join(out, `${scene}@${scale}x.png`);
            const shot = spawnSync(chrome, [
                '--headless=new',
                '--disable-gpu',
                '--hide-scrollbars',
                `--force-device-scale-factor=${scale}`,
                `--window-size=${WIDTH},${HEIGHT}`,
                '--virtual-time-budget=1500',
                `--screenshot=${file}`,
                `http://localhost:${port}/?mock=${scene}`,
            ]);
            if (shot.status !== 0) throw new Error(`chrome failed on ${scene}: ${shot.stderr}`);
            console.log(file);
        }
    }
} finally {
    server.kill();
}
