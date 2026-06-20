import * as fs from 'fs';
import * as path from 'path';

export interface ProfileState {
    modelId?: string;
    modelLabel?: string;
}

/** Stable filesystem key for a profile / agent display name. */
export function sanitizeProfileScopeKey(name: string, fallback = '__default__'): string {
    const trimmed = (name || '').trim();
    if (!trimmed) {
        return fallback;
    }
    return trimmed.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120) || fallback;
}

export function profileDir(historyDir: string, scopeKey: string): string {
    const dir = path.join(historyDir, 'profiles', scopeKey);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

export function sessionsPathFor(historyDir: string, scopeKey: string): string {
    return path.join(profileDir(historyDir, scopeKey), 'sessions.json');
}

export function activeSessionPathFor(historyDir: string, scopeKey: string): string {
    return path.join(profileDir(historyDir, scopeKey), 'active-session.txt');
}

export function profileStatePathFor(historyDir: string, scopeKey: string): string {
    return path.join(profileDir(historyDir, scopeKey), 'profile-state.json');
}

export function loadProfileState(historyDir: string, scopeKey: string): ProfileState {
    try {
        const p = profileStatePathFor(historyDir, scopeKey);
        if (fs.existsSync(p)) {
            return JSON.parse(fs.readFileSync(p, 'utf-8')) as ProfileState;
        }
    } catch { /* ignore */ }
    return {};
}

export function saveProfileState(historyDir: string, scopeKey: string, state: ProfileState): void {
    try {
        fs.writeFileSync(profileStatePathFor(historyDir, scopeKey), JSON.stringify(state, null, 2));
    } catch { /* ignore */ }
}

/** Move legacy global session files into the default profile scope once. */
export function migrateLegacySessionStorage(historyDir: string, defaultScopeKey: string): void {
    const legacySessions = path.join(historyDir, 'sessions.json');
    if (!fs.existsSync(legacySessions)) {
        return;
    }
    const targetSessions = sessionsPathFor(historyDir, defaultScopeKey);
    if (fs.existsSync(targetSessions)) {
        return;
    }
    profileDir(historyDir, defaultScopeKey);
    fs.renameSync(legacySessions, targetSessions);
    const legacyActive = path.join(historyDir, 'active-session.txt');
    if (fs.existsSync(legacyActive)) {
        fs.renameSync(legacyActive, activeSessionPathFor(historyDir, defaultScopeKey));
    }
}
