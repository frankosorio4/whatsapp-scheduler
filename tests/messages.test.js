// tests/messages.test.js
//
// Unit tests for src/utils/messages.js.
// getHelpMessage is pure. getLogsMessage depends on logger.getLastLogLines,
// which is mocked here so tests never touch the real filesystem.

jest.mock('../src/utils/logger', () => ({
    getLastLogLines: jest.fn(),
}));

const { getHelpMessage, getLogsMessage } = require('../src/utils/messages');
const { getLastLogLines } = require('../src/utils/logger');

// ---------------------------------------------------------------------------
// 1. getHelpMessage()
// ---------------------------------------------------------------------------
describe('getHelpMessage()', () => {

    // --- Owner ---

    it('returns a string when isOwner is true', () => {
        expect(typeof getHelpMessage(true)).toBe('string');
    });

    it('owner response includes all owner-only commands', () => {
        const result = getHelpMessage(true);
        expect(result).toContain('!ping');
        expect(result).toContain('!sync');
        expect(result).toContain('!pending');
        expect(result).toContain('!archive');
        expect(result).toContain('!logs');
        expect(result).toContain('!new-schedule');
        expect(result).toContain('!confirm');
        expect(result).toContain('!cancel');
        expect(result).toContain('!reset-bot');
        expect(result).toContain('!help');
    });

    // --- Non-owner ---

    it('returns a string when isOwner is false', () => {
        expect(typeof getHelpMessage(false)).toBe('string');
    });

    it('non-owner response includes public commands', () => {
        const result = getHelpMessage(false);
        expect(result).toContain('!ping');
        expect(result).toContain('!help');
    });

    it('non-owner response does not include owner-only commands', () => {
        const result = getHelpMessage(false);
        expect(result).not.toContain('!sync');
        expect(result).not.toContain('!pending');
        expect(result).not.toContain('!archive');
        expect(result).not.toContain('!logs');
        expect(result).not.toContain('!new-schedule');
        expect(result).not.toContain('!confirm');
        expect(result).not.toContain('!cancel');
        expect(result).not.toContain('!reset-bot');
    });

    it('owner and non-owner responses are different', () => {
        expect(getHelpMessage(true)).not.toBe(getHelpMessage(false));
    });

    it('owner response is longer than non-owner response', () => {
        expect(getHelpMessage(true).length).toBeGreaterThan(getHelpMessage(false).length);
    });

});

// ---------------------------------------------------------------------------
// 2. getLogsMessage()
// ---------------------------------------------------------------------------
describe('getLogsMessage()', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    // --- Invalid input ---

    it('returns an error message for n = 0', () => {
        const result = getLogsMessage(0);
        expect(result).toContain('❌');
    });

    it('returns an error message for a negative number', () => {
        const result = getLogsMessage(-5);
        expect(result).toContain('❌');
    });

    it('returns an error message for a non-numeric string', () => {
        const result = getLogsMessage('abc');
        expect(result).toContain('❌');
    });

    it('does not call getLastLogLines for invalid input', () => {
        getLogsMessage(0);
        expect(getLastLogLines).not.toHaveBeenCalled();
    });

    // --- Empty log ---

    it('returns "no messages" reply when log is empty', () => {
        getLastLogLines.mockReturnValue([]);
        const result = getLogsMessage(10);
        expect(result).toContain('No messages logged yet');
    });

    it('calls getLastLogLines with the correct count', () => {
        getLastLogLines.mockReturnValue([]);
        getLogsMessage(5);
        expect(getLastLogLines).toHaveBeenCalledWith(5);
    });

    // --- Non-empty log ---

    it('returns formatted reply containing log lines', () => {
        getLastLogLines.mockReturnValue([
            '[03/04/2026 14:30] | Pay rent | 5511999999999 | 03/04 | 14:30 | Transfer R$1500',
            '[03/04/2026 15:00] | Follow up | 5511888888888 | 03/04 | 15:00 | Check in on project',
        ]);
        const result = getLogsMessage(2);
        expect(result).toContain('Pay rent');
        expect(result).toContain('Follow up');
    });

    it('header shows the actual number of lines returned, not the requested count', () => {
        // Requested 10 but only 2 exist
        getLastLogLines.mockReturnValue([
            '[03/04/2026 14:30] | A | 5511 | 03/04 | 14:30 | msg',
            '[03/04/2026 15:00] | B | 5511 | 03/04 | 15:00 | msg',
        ]);
        const result = getLogsMessage(10);
        expect(result).toContain('2');
    });

    it('passes a numeric string n correctly to getLastLogLines', () => {
        getLastLogLines.mockReturnValue(['line one']);
        getLogsMessage('7');
        expect(getLastLogLines).toHaveBeenCalledWith(7);
    });

    it('returns lines joined with newlines in the reply', () => {
        getLastLogLines.mockReturnValue(['line one', 'line two', 'line three']);
        const result = getLogsMessage(3);
        expect(result).toContain('line one');
        expect(result).toContain('line two');
        expect(result).toContain('line three');
    });

    it('includes an emoji header in a non-empty reply', () => {
        getLastLogLines.mockReturnValue(['some log line']);
        const result = getLogsMessage(1);
        expect(result).toContain('📋');
    });

});
