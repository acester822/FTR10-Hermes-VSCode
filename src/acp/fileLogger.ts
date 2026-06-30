import * as fs from 'fs';
import * as path from 'path';

const LOG_DIR = '/home/ftr/Apps/rina-hermes-acp/logs';
const LOG_FILE = path.join(LOG_DIR, 'hermes-acp.log');

let _stream: fs.WriteStream | null = null;

function ensureStream(): fs.WriteStream {
    if (!_stream) {
        if (!fs.existsSync(LOG_DIR)) {
            fs.mkdirSync(LOG_DIR, { recursive: true });
        }
        _stream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
    }
    return _stream;
}

export function logToFile(message: string, ...args: unknown[]): void {
    const timestamp = new Date().toISOString();
    const line = args.length > 0
        ? `[${timestamp}] ${message} ${args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')}`
        : `[${timestamp}] ${message}`;
    try {
        ensureStream().write(line + '\n');
    } catch {
        // silently ignore file write errors
    }
}

export function closeLogger(): void {
    if (_stream) {
        _stream.end();
        _stream = null;
    }
}

export function getLogFilePath(): string {
    return LOG_FILE;
}
