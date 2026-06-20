export type ReadTextFileOptions = {
    line?: number | null;
    limit?: number | null;
};

/** Slice file text by 1-based line number and max line count (ACP fs/read_text_file). */
export function sliceTextByLines(
    content: string,
    line?: number | null,
    limit?: number | null
): string {
    const lines = content.split(/\r?\n/);
    const hasLine = line != null && line > 0;
    const hasLimit = limit != null && limit > 0;
    if (!hasLine && !hasLimit) {
        return content;
    }

    const start = hasLine ? line! - 1 : 0;
    const end = hasLimit ? start + limit! : lines.length;
    return lines.slice(start, end).join('\n');
}
