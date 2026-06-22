import { spawn } from 'child_process';
import { client, ndJsonStream, methods, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';

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

function extractInline(content) {
    return content?.text || content?.content?.text || '';
}

function extractRobust(content) {
    if (content == null) return '';
    if (typeof content === 'string') return content;
    if (typeof content.text === 'string') return content.text;
    if (Array.isArray(content)) return content.map(extractRobust).join('');
    if (typeof content === 'object' && content.content != null) return extractRobust(content.content);
    return '';
}

const proc = spawn('hermes', ['acp', '--profile', 'default'], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
});
proc.stderr.on('data', (d) => process.stderr.write('[stderr] ' + d.toString()));

const stream = makeStream(proc);
const app = client({ name: 'prompt-test' });

app.onNotification('session/update', ({ params }) => {
    const update = params.update;
    if (update?.sessionUpdate === 'agent_message_chunk' || update?.sessionUpdate === 'agent_thought_chunk') {
        const inline = extractInline(update.content);
        const robust = extractRobust(update.content);
        console.log(`[${update.sessionUpdate}] inline=${JSON.stringify(inline)} robust=${JSON.stringify(robust)} raw=${JSON.stringify(update.content).slice(0, 400)}`);
    } else {
        console.log('[session/update]', update?.sessionUpdate, JSON.stringify(update).slice(0, 300));
    }
});

app.onRequest('session/request_permission', async ({ params }) => {
    console.log('[permission]', JSON.stringify(params).slice(0, 300));
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
try {
    await conn.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: true },
            terminal: true,
        },
    });
    const session = await conn.agent.buildSession({ cwd: process.cwd(), mcpServers: [] }).start();
    console.log('[session]', session.sessionId);

    const [response, text] = await Promise.all([
        session.prompt('Say hello in one short sentence.'),
        session.readText(),
    ]);
    console.log('[readText]', JSON.stringify(text), 'len=', text.length);
    console.log('[prompt response]', JSON.stringify(response));
} catch (err) {
    console.error('[error]', err);
    process.exitCode = 1;
} finally {
    proc.kill();
}
