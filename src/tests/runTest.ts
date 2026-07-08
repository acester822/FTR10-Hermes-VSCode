import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
    try {
        const extensionDevelopmentPath = path.resolve(__dirname, '../..');
        const extensionTestsPath = path.resolve(__dirname, './suite/index');

        // Unset ELECTRON_RUN_AS_NODE which is set by code-server and breaks
        // VS Code's CLI argument parsing (causes "bad option" errors for all flags)
        delete process.env.ELECTRON_RUN_AS_NODE;

        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: ['--disable-extensions'],
        });
    } catch (err) {
        console.error('Failed to run tests:', err);
        process.exit(1);
    }
}

main();
