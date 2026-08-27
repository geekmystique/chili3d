// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Shared stubs for the `@chili3d/core` mocks used by UI tests.
// Test files import one of the sibling `mockCore*.ts` modules (e.g. `mockCoreI18n`,
// `mockCoreProperty`, `mockCorePubSub`) BEFORE importing the module under test;
// each of those registers its `rs.mock("@chili3d/core", ...)` at module scope and
// composes the stubs below (`rs.mock` factories must stay sync — rstest does not
// await async factories — so these helpers are loaded via `rs.hoisted`).
//
// File-specific overrides (PubSub recorders, PropertyUtils, Config, ...) stay in
// the individual test files.

/** I18n stub: `translate` returns the key itself. */
export const I18nMock = {
    translate: (key: unknown, ..._args: unknown[]) => String(key),
};

/** Localize stub: `toString` returns the key itself. */
export class LocalizeMock {
    private key: unknown;
    constructor(key: unknown) {
        this.key = key;
    }
    toString() {
        return String(this.key);
    }
}

export class BindingMock {
    constructor(_value: unknown, _prop?: string, _converter?: unknown) {}
}

export class PathBindingMock {
    constructor(_value: unknown, _prop?: string, _converter?: unknown) {}
}

/** Transaction stub: executes the callback immediately. */
export const TransactionMock = {
    execute: (_doc: unknown, _desc: string, fn: () => void) => fn(),
};

/** No-op PubSub stub. */
export const PubSubMock = {
    default: {
        pub: () => {},
        sub: () => {},
    },
};

/**
 * PubSub stub that records `sub` handlers (keyed by topic) and `pub` calls, so
 * tests can look handlers up, invoke them directly and assert published topics.
 * Call `reset()` between tests.
 *
 * `handlers.get(topic)` always returns one callable, matching real PubSub's
 * single-topic-many-subscribers shape from the caller's side: subscribing a
 * second handler to a topic that already has one doesn't replace it (a plain
 * `Map.set` would) - both are kept, in registration order, and `.get(topic)`
 * returns a small wrapper that invokes all of them. `remove` drops just the
 * matching handler, same as real PubSub.
 */
export function createPubSubRecorder() {
    const registrations = new Map<string, Array<(...args: unknown[]) => unknown>>();
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const pubs: { topic: string; args: unknown[] }[] = [];

    function rebuild(topic: string) {
        const list = registrations.get(topic);
        if (!list || list.length === 0) {
            handlers.delete(topic);
            return;
        }
        handlers.set(topic, (...args: unknown[]) => {
            list.forEach((h) => h(...args));
        });
    }

    return {
        handlers,
        pubs,
        stub: {
            default: {
                pub: (topic: string, ...args: unknown[]) => {
                    pubs.push({ topic, args });
                },
                sub: (topic: string, handler: (...args: unknown[]) => unknown) => {
                    const list = registrations.get(topic) ?? [];
                    list.push(handler);
                    registrations.set(topic, list);
                    rebuild(topic);
                },
                remove: (topic: string, handler: (...args: unknown[]) => unknown) => {
                    const list = registrations.get(topic);
                    if (!list) return;
                    const index = list.indexOf(handler);
                    if (index !== -1) list.splice(index, 1);
                    rebuild(topic);
                },
            },
        },
        reset() {
            registrations.clear();
            handlers.clear();
            pubs.length = 0;
        },
    };
}

export type PubSubRecorder = ReturnType<typeof createPubSubRecorder>;

/** Minimal ObservableCollection stub backed by a plain array. */
// biome-ignore lint/suspicious/noExplicitAny: test mock
export class ObservableCollectionMock<T = any> {
    private items: T[];
    constructor(...items: T[]) {
        this.items = items;
    }
    get length() {
        return this.items.length;
    }
    replace(index: number, item: T) {
        this.items[index] = item;
    }
    find(fn: (m: T) => boolean) {
        return this.items.find(fn);
    }
    forEach(fn: (m: T) => void) {
        this.items.forEach(fn);
    }
}
