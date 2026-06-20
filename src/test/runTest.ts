import { runTests } from '@vscode/test-electron';
import * as path from 'path';

async function main() {
    try {
        await runTests({
            extensionDevelopmentPath: path.resolve(__dirname, '../..'),
            extensionTestsPath: path.resolve(__dirname, './suite/index'),
            launchArgs: ['--disable-extensions'],
        });
    } catch (err) {
        process.exit(1);
    }
}

main();
