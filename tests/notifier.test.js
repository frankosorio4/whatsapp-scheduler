// tests/notifier.test.js
//
// Unit tests for src/utils/notifier.js.
// withRetry is pure async logic — testable with simple mock functions.
// notifyOwner is tested with a minimal client stub.

const { withRetry, notifyOwner } = require('../src/utils/notifier');

// ---------------------------------------------------------------------------
// 1. withRetry — success cases
// ---------------------------------------------------------------------------
describe('withRetry() - success', () => {

    it('returns the resolved value when fn succeeds on the first attempt', async () => {
        const fn = jest.fn().mockResolvedValue('ok');
        const result = await withRetry(fn);
        expect(result).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('returns the resolved value when fn succeeds on the second attempt', async () => {
        const fn = jest.fn()
            .mockRejectedValueOnce(new Error('transient'))
            .mockResolvedValue('ok');
        const result = await withRetry(fn, 3, 0); // delayMs=0 for fast tests
        expect(result).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('returns the resolved value when fn succeeds on the last allowed attempt', async () => {
        const fn = jest.fn()
            .mockRejectedValueOnce(new Error('fail 1'))
            .mockRejectedValueOnce(new Error('fail 2'))
            .mockResolvedValue('ok');
        const result = await withRetry(fn, 3, 0);
        expect(result).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(3);
    });

});

// ---------------------------------------------------------------------------
// 2. withRetry — failure cases
// ---------------------------------------------------------------------------
describe('withRetry() - failure', () => {

    it('throws the last error after all retries are exhausted', async () => {
        const fn = jest.fn().mockRejectedValue(new Error('permanent'));
        await expect(withRetry(fn, 3, 0)).rejects.toThrow('permanent');
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it('calls fn exactly `retries` times when it always fails', async () => {
        const fn = jest.fn().mockRejectedValue(new Error('fail'));
        await expect(withRetry(fn, 5, 0)).rejects.toThrow();
        expect(fn).toHaveBeenCalledTimes(5);
    });

    it('re-throws the error from the final attempt, not an earlier one', async () => {
        const fn = jest.fn()
            .mockRejectedValueOnce(new Error('first error'))
            .mockRejectedValueOnce(new Error('last error'));
        await expect(withRetry(fn, 2, 0)).rejects.toThrow('last error');
    });

    it('calls fn only once when retries is set to 1', async () => {
        const fn = jest.fn().mockRejectedValue(new Error('fail'));
        await expect(withRetry(fn, 1, 0)).rejects.toThrow('fail');
        expect(fn).toHaveBeenCalledTimes(1);
    });

});

// ---------------------------------------------------------------------------
// 3. withRetry — default parameters
// ---------------------------------------------------------------------------
describe('withRetry() - defaults', () => {

    it('retries 3 times by default when retries is not specified', async () => {
        // Pass delayMs=0 via a wrapper to avoid waiting on real timers,
        // while still exercising the default retries=3 parameter.
        // We can't override the default delayMs without passing retries,
        // so we verify the retry count by inspecting call count after exhaustion.
        const fn = jest.fn().mockRejectedValue(new Error('fail'));
        // Call withRetry with only the fn argument to hit the default retries=3.
        // Use a tiny delayMs to keep the test fast without fake timers.
        await expect(withRetry(fn, undefined, 0)).rejects.toThrow('fail');
        expect(fn).toHaveBeenCalledTimes(3);
    });

});

// ---------------------------------------------------------------------------
// 4. notifyOwner — sends message to owner
// ---------------------------------------------------------------------------
describe('notifyOwner()', () => {

    const ORIGINAL_OWNER = process.env.OWNER_NUMBER;

    beforeEach(() => {
        process.env.OWNER_NUMBER = '5511999999999';
    });

    afterEach(() => {
        process.env.OWNER_NUMBER = ORIGINAL_OWNER;
    });

    it('calls client.sendMessage with the correct owner number and message', async () => {
        const client = { sendMessage: jest.fn().mockResolvedValue(undefined) };
        await notifyOwner(client, 'test alert');
        expect(client.sendMessage).toHaveBeenCalledWith('5511999999999@c.us', 'test alert');
    });

    it('calls sendMessage exactly once', async () => {
        const client = { sendMessage: jest.fn().mockResolvedValue(undefined) };
        await notifyOwner(client, 'hello');
        expect(client.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('does not throw when client.sendMessage rejects', async () => {
        const client = { sendMessage: jest.fn().mockRejectedValue(new Error('WA error')) };
        await expect(notifyOwner(client, 'alert')).resolves.toBeUndefined();
    });

    it('does not throw when OWNER_NUMBER is undefined', async () => {
        delete process.env.OWNER_NUMBER;
        const client = { sendMessage: jest.fn().mockResolvedValue(undefined) };
        await expect(notifyOwner(client, 'alert')).resolves.toBeUndefined();
    });

});
