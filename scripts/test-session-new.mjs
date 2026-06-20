import { spawn } from 'child_process';
import { client, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import { resolveMcpServersForSession } from '../out/acp/mcpConfig.js';

function makeStream(proc) {
    const childInput = new WritableStream({
        write(chunk) {
            proc.stdin.write(Buffer.from(chunk));
        },
        close() {
            proc.stdin.end();
        },
    });
    const childOutput = new ReadableStream({
        start(controller) {
            proc.stdout.on('data', (chunk) => controller.enqueue(new Uint8Array(chunk)));
            proc.stdout.on('end', () => controller.close());
        },
    });
    return ndJsonStream(childInput, childOutput);
}

async function run(label, mcpServers) {
    const proc = spawn('hermes', ['acp'], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    const stream = makeStream(proc);
    const app = client({ name: 'test' });
    const conn = app.connect(stream);
    try {
        await conn.agent.request('initialize', {
            protocolVersion: PROTOCOL_VERSION,
            clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
        });
        const session = await conn.agent
            .buildSession({ cwd: process.cwd(), mcpServers })
            .start();
        console.log(`${label}: OK sessionId=${session.sessionId} mcpCount=${mcpServers.length}`);
    } catch (err) {
        console.error(`${label}: FAIL`, err?.message || err);
        if (stderr.trim()) console.error('stderr:', stderr.trim().slice(0, 800));
        process.exitCode = 1;
    } finally {
        proc.kill();
    }
}

const cwd = process.cwd();
const resolved = resolveMcpServersForSession(cwd);
console.log('Resolved MCP servers:', resolved.map(s => s.name).join(', ') || '(none)');
await run('editor mcp.json', resolved);
