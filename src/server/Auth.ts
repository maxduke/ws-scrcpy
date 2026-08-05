import * as crypto from 'crypto';
import * as fs from 'fs';
import { IncomingMessage, ServerResponse } from 'http';
import { EnvName } from './EnvName';

const AUTH_REALM = 'ws-scrcpy';

export class Auth {
    private static readonly username = process.env[EnvName.AUTH_USER] || '';
    private static readonly password = Auth.readPassword();

    public static get enabled(): boolean {
        return this.username.length > 0 && this.password.length > 0;
    }

    public static isAuthorized(request: IncomingMessage): boolean {
        if (!this.enabled) {
            return true;
        }

        const header = request.headers.authorization;
        if (!header || !header.startsWith('Basic ')) {
            return false;
        }

        let decoded: string;
        try {
            decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
        } catch (_error) {
            return false;
        }

        const separator = decoded.indexOf(':');
        if (separator < 0) {
            return false;
        }

        const username = decoded.slice(0, separator);
        const password = decoded.slice(separator + 1);
        return this.safeEqual(username, this.username) && this.safeEqual(password, this.password);
    }

    public static rejectHttp(response: ServerResponse): void {
        response.setHeader('WWW-Authenticate', `Basic realm="${AUTH_REALM}", charset="UTF-8"`);
        response.statusCode = 401;
        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
        response.end('Authentication required');
    }

    public static unauthorizedUpgradeResponse(): string {
        return [
            'HTTP/1.1 401 Unauthorized',
            `WWW-Authenticate: Basic realm="${AUTH_REALM}", charset="UTF-8"`,
            'Connection: close',
            'Content-Length: 0',
            '',
            '',
        ].join('\r\n');
    }

    private static readPassword(): string {
        const passwordFile = process.env[EnvName.AUTH_PASSWORD_FILE];
        if (passwordFile) {
            try {
                return fs.readFileSync(passwordFile, 'utf8').replace(/[\r\n]+$/, '');
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                throw new Error(`Unable to read ${EnvName.AUTH_PASSWORD_FILE}: ${message}`);
            }
        }
        return process.env[EnvName.AUTH_PASSWORD] || '';
    }

    private static safeEqual(actual: string, expected: string): boolean {
        const actualBuffer = Buffer.from(actual);
        const expectedBuffer = Buffer.from(expected);
        return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
    }
}
