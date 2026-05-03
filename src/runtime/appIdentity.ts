import fs from 'fs/promises';
import path from 'path';

function toKebabCase(value: string): string {
    return value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-{2,}/g, '-');
}

async function readPackageName(cwd: string): Promise<string> {
    try {
        const packageJsonPath = path.join(cwd, 'package.json');
        const pkg = JSON.parse(await fs.readFile(packageJsonPath, 'utf8')) as { name?: string };
        return String(pkg.name || '');
    } catch {
        return '';
    }
}

export async function resolveAppIdentity(inputName?: string): Promise<string> {
    const cwd = process.cwd();
    const candidates = [
        inputName,
        process.env.NETGET_APP_NAME,
        await readPackageName(cwd),
        path.basename(cwd),
        `app-${process.pid}`,
    ];

    for (const candidate of candidates) {
        const normalized = toKebabCase(String(candidate || ''));
        if (normalized) return normalized;
    }

    return `app-${process.pid}`;
}

export { toKebabCase as normalizeAppName };
