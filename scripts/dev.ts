import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
if (!existsSync('.env')) { console.error('Create .env from .env.example for Discord development, or run pnpm build:demo && pnpm demo for the local fixture console.'); process.exit(1); }
const children = ['dev:bot', 'dev:web', 'dev:dashboard'].map(script => spawn('pnpm', [script], { stdio: 'inherit', env: { ...process.env, ...(script === 'dev:web' ? { WEB_PORT: '3002' } : {}) } }));
let stopping = false;
const stop = () => { if (stopping) return; stopping = true; for (const child of children) child.kill('SIGTERM'); };
for (const child of children) child.once('exit', code => { if (!stopping) { process.exitCode = code ?? 1; stop(); } });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop);
