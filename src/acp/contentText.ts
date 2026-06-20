/** Extract display text from an ACP content block (and legacy nested shapes). */
export function extractTextFromContentBlock(content: unknown): string {
    if (content == null) {
        return '';
    }
    if (typeof content === 'string') {
        return content;
    }
    if (Array.isArray(content)) {
        return content.map(extractTextFromContentBlock).join('');
    }
    if (typeof content !== 'object') {
        return '';
    }

    const block = content as Record<string, unknown>;
    if (typeof block.text === 'string') {
        return block.text;
    }
    if (typeof block.thought === 'string') {
        return block.thought;
    }
    if (Array.isArray(block.content)) {
        return extractTextFromContentBlock(block.content);
    }
    if (block.content != null) {
        return extractTextFromContentBlock(block.content);
    }
    return '';
}
