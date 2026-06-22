import { spawn } from 'child_process';
import { Writable, Readable } from 'node:stream';
import { client, ndJsonStream, methods, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';

const proc = spawn('hermes', ['acp', '--profile', 'default'], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
});
proc.stderr.on('data', (d) => process.stderr.write('[stderr] ' + d.toString()));

const stream = ndJsonStream(
    Writable.toWeb(proc.stdin),
    Readable.toWeb(proc.stdout),
);

let chunks = 0;
const app = client({ name: 'native-stream-test' });
app.onNotification('session/update', ({ params }) => {
    const u = params.update;
    if (u?.sessionUpdate === 'agent_message_chunk') {
        chunks++;
        console.log('[chunk]', JSON.stringify(u.content));
    }
});

app.onRequest('session/request_permission', async ({ params }) => {
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

const timeout = setTimeout(() => {
    console.error('[TIMEOUT] chunks=', chunks);
    proc.kill();
    process.exit(2);
}, 60000);

try {
    const result = await app.connectWith(stream, async (agent) => {
        await agent.request(methods.agent.initialize, {
            protocolVersion: PROTOCOL_VERSION,
            clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
        });
        return agent.buildSession(process.cwd()).withSession(async (session) => {
            console.log('[session]', session.sessionId);
            const promptPromise = session.prompt('Reply with exactly: OK');
            const text = await session.readText();
            const response = await promptPromise;
            return { text, response };
        });
    });
    console.log('[done]', JSON.stringify(result), 'chunks=', chunks);
} catch (err) {
    console.error('[error]', err);
    process.exitCode = 1;
} finally {
    clearTimeout(timeout);
    proc.kill();
}
