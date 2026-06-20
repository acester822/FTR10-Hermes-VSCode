import { LocaleKey, LocaleStrings } from './types';

/** ACP + Hermes permission option kinds / optionIds → locale key. */
const KIND_TO_LOCALE_KEY: Record<string, LocaleKey> = {
    allow_once: 'permissionAllowOnce',
    allow_always: 'permissionAllowAlways',
    allow_session: 'permissionAllowSession',
    reject_once: 'permissionRejectOnce',
    reject_always: 'permissionRejectAlways',
    deny_once: 'permissionRejectOnce',
    deny_always: 'permissionRejectAlways',
    deny: 'permissionDeny',
};

function normalizePermissionToken(value: string): string {
    return value.trim().toLowerCase().replace(/-/g, '_');
}

/** Resolve a permission button label: i18n by kind/optionId, else agent-provided name. */
export function resolvePermissionOptionLabel(
    strings: LocaleStrings,
    option: { optionId: string; name?: string; kind?: string }
): string {
    const id = normalizePermissionToken(option.optionId);
    const kind = normalizePermissionToken(option.kind ?? '');

    // optionId is authoritative when kind/id disagree (Hermes may send mismatched kind).
    if (KIND_TO_LOCALE_KEY[id]) {
        return strings[KIND_TO_LOCALE_KEY[id]];
    }
    if (kind && KIND_TO_LOCALE_KEY[kind]) {
        return strings[KIND_TO_LOCALE_KEY[kind]];
    }

    const tokens = [id, kind].filter(Boolean);
    for (const token of tokens) {
        if (token.includes('allow') && token.includes('session')) {
            return strings.permissionAllowSession;
        }
    }
    for (const token of tokens) {
        if (token.includes('allow') && token.includes('always')) {
            return strings.permissionAllowAlways;
        }
    }
    for (const token of tokens) {
        if (token.includes('allow')) {
            return strings.permissionAllowOnce;
        }
    }
    for (const token of tokens) {
        if ((token.includes('reject') || token.includes('deny')) && token.includes('always')) {
            return strings.permissionRejectAlways;
        }
    }
    for (const token of tokens) {
        if (token.includes('reject') || token.includes('deny')) {
            return token.includes('once') ? strings.permissionRejectOnce : strings.permissionDeny;
        }
    }

    return option.name?.trim() || option.optionId;
}
