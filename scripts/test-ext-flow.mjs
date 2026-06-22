import { spawn } from 'child_process';
import { client, ndJsonStream, methods, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import { resolveMcpServersForSession } from '../out/acp/mcpConfig.js';

function makeStream(proc) {
    const childInput = new WritableStream({
        write(chunk) { proc.stdin.write(Buffer.from(chunk)); },
        close() { proc.stdin.end(); },
    });
    const childOutput = new ReadableStream({
        start(controller) {
            proc.stdout.on('data', (chunk) => controller.enqueue(new Uint8Array(chunk)));
            proc.stdout.on('end', () => controller.close());
        },
    });
    return ndJsonStream(childInput, childOutput);
}

const cwd = process.cwd();
const mcpServers = resolveMcpServersForSession(cwd);
console.log('[mcp]', mcpServers.map(s => s.name).join(', ') || '(none)');

const proc = spawn('hermes', ['acp', '--profile', 'default'], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
proc.stderr.on('data', (d) => process.stderr.write('[stderr] ' + d.toString()));

const stream = makeStream(proc);
const app = client({ name: 'ext-flow-test' });

let chunks = 0;
app.onNotification('session/update', ({ params }) => {
    const u = params.update;
    if (u?.sessionUpdate === 'agent_message_chunk') {
        chunks++;
        console.log('[chunk]', JSON.stringify(u.content).slice(0, 200));
    } else if (u?.sessionUpdate === 'agent_thought_chunk') {
        console.log('[thought]', JSON.stringify(u.content).slice(0, 200));
    }
});

app.onRequest('session/request_permission', async ({ params }) => {
    console.log('[permission]', params.toolCall?.title || params.description);
    const allow = params.options?.find(o => String(o.optionId).startsWith('allow'));
    return { outcome: { outcome: 'selected', optionId: allow?.optionId ?? params.options?.[0]?.optionId } };
});
app.onRequest(methods.client.fs.readTextFile, async () => ({ content: '' }));
app.onRequest(methods.client.fs.writeTextFile, async () => ({}));
app.onRequest(methods.client.terminal.create, async () => ({ terminalId: 't1' }));
app.onRequest(methods.client.terminal.output, async () => ({ output: '', truncated: false }));
app.onRequest(methods.client.terminal.waitForExit, async () => ({ exitCode: 0 }));
app.onRequest(methods.client.terminal.release, async () => ({}));
app.onRequest(methods.client.terminal.kill, async () => ({}));

const conn = app.connect(stream);
const timeout = setTimeout(() => {
    console.error('[TIMEOUT] no response after 90s, chunks=', chunks);
    proc.kill();
    process.exit(2);
}, 90000);

try {
    await conn.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
    });
    let session = await conn.agent.buildSession({ cwd, mcpServers }).start();
    console.log('[session1]', session.sessionId);

    // simulate extension model reset
    try {
        await conn.agent.request('session/set_model', {
            sessionId: session.sessionId,
            modelId: 'deepseek-v4-flash',
        });
        console.log('[set_model] ok');
    } catch (e) {
        console.log('[set_model] failed', e.message);
    }

    const response = await session.prompt('Reply with exactly: OK');
    console.log('[response]', JSON.stringify(response), 'chunks=', chunks);
} catch (err) {
    console.error('[error]', err);
    process.exitCode = 1;
} finally {
    clearTimeout(timeout);
    proc.kill();
}
