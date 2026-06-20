/** Hermes built-in default profile id (`hermes --profile default`). */
export const HERMES_DEFAULT_PROFILE = 'default';

/** Normalize settings / UI values into a Hermes CLI `--profile` argument. */
export function normalizeHermesCliProfile(profile?: string | null): string {
    const trimmed = (profile ?? '').trim();
    if (!trimmed || trimmed === HERMES_DEFAULT_PROFILE) {
        return HERMES_DEFAULT_PROFILE;
    }
    return trimmed;
}
