// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, rs, test } from "@rstest/core";

// CSS modules — shared ones via helper, file-specific ones inline
import "./_helpers/cssMocks";

rs.mock("../src/timeline/timeline.module.css", () => ({
    root: "tl-root",
    label: "tl-label",
}));

// Track PubSub subscriptions via the shared recorder
const pubSubRecorder = rs.hoisted(() => {
    const { createPubSubRecorder } = require("./_helpers/coreMocks");
    return createPubSubRecorder();
});

// Mock core
rs.mock("@chili3d/core", () => {
    const actual = rs.hoisted(() => require("@chili3d/core"));
    const { I18nMock, LocalizeMock } = rs.hoisted(() => require("./_helpers/coreMocks"));
    return {
        ...actual,
        Localize: LocalizeMock,
        I18n: I18nMock,
        PubSub: pubSubRecorder.stub,
    };
});

// Mock element helpers
import "./_helpers/mockElement";

// Mock timelineTrack — use a plain class (not extending HTMLElement) since Happy-DOM
// forbids `new` on custom elements registered via customElements.define().
rs.mock("../src/timeline/timelineTrack", () => {
    class TimelineTrack {
        _doc: unknown;
        disposed = false;
        removed = false;
        constructor(doc: unknown) {
            this._doc = doc;
        }
        remove() {
            this.removed = true;
        }
        dispose() {
            this.disposed = true;
        }
    }
    return { TimelineTrack };
});

import { Timeline } from "../src/timeline/timeline";
import { TimelineTrack } from "../src/timeline/timelineTrack";

describe("Timeline", () => {
    beforeEach(() => {
        pubSubRecorder.reset();
    });

    describe("constructor", () => {
        test("should apply provided className and root style", () => {
            const tl = new Timeline({ className: "test-panel" });
            expect(tl.className).toContain("test-panel");
            expect(tl.className).toContain("tl-root");
        });

        test("should render the header label", () => {
            const tl = new Timeline({ className: "test-panel" });
            const label = tl.querySelector("span");
            expect(label).not.toBeNull();
        });

        test("should subscribe to activeViewChanged", () => {
            new Timeline({ className: "test-panel" });
            expect(pubSubRecorder.handlers.has("activeViewChanged")).toBe(true);
        });

        test("should subscribe to documentClosed", () => {
            new Timeline({ className: "test-panel" });
            expect(pubSubRecorder.handlers.has("documentClosed")).toBe(true);
        });
    });

    function makeDoc() {
        return {
            modelManager: { rootNode: { firstChild: null }, addNodeObserver: () => {} },
            selection: { onNodeChanged: { sub: () => {}, remove: () => {} } },
        };
    }

    describe("handleActiveViewChanged", () => {
        test("should create and mount a track when a view is provided", () => {
            const tl = new Timeline({ className: "test-panel" });
            const doc = makeDoc();

            const handler = pubSubRecorder.handlers.get("activeViewChanged");
            expect(handler).toBeDefined();
            handler!({ document: doc });

            expect(tl.activeTrack()).toBeInstanceOf(TimelineTrack);
        });

        test("should ignore an undefined view", () => {
            const tl = new Timeline({ className: "test-panel" });
            const handler = pubSubRecorder.handlers.get("activeViewChanged");
            expect(handler).toBeDefined();

            handler!(undefined);

            expect(tl.activeTrack()).toBeUndefined();
        });

        test("should not recreate the track for the same document", () => {
            const tl = new Timeline({ className: "test-panel" });
            const doc = makeDoc();
            const handler = pubSubRecorder.handlers.get("activeViewChanged");

            handler!({ document: doc });
            const track1 = tl.activeTrack();
            handler!({ document: doc });
            const track2 = tl.activeTrack();

            expect(track1).toBe(track2);
        });

        test("should switch active track for a different document", () => {
            const tl = new Timeline({ className: "test-panel" });
            const doc1 = makeDoc();
            const doc2 = makeDoc();
            const handler = pubSubRecorder.handlers.get("activeViewChanged");

            handler!({ document: doc1 });
            const track1 = tl.activeTrack();
            handler!({ document: doc2 });
            const track2 = tl.activeTrack();

            expect(track1).not.toBe(track2);
        });
    });

    describe("handleDocumentClosed", () => {
        test("should remove and dispose the track when its document closes", () => {
            const tl = new Timeline({ className: "test-panel" });
            const doc = makeDoc();

            const activeHandler = pubSubRecorder.handlers.get("activeViewChanged");
            activeHandler!({ document: doc });
            const track = tl.activeTrack() as unknown as { removed: boolean; disposed: boolean };

            const closeHandler = pubSubRecorder.handlers.get("documentClosed");
            expect(closeHandler).toBeDefined();
            closeHandler!(doc);

            expect(track.removed).toBe(true);
            expect(track.disposed).toBe(true);
            expect(tl.activeTrack()).toBeUndefined();
        });

        test("should leave the active track untouched when an unrelated document closes", () => {
            const tl = new Timeline({ className: "test-panel" });
            const doc = makeDoc();

            const activeHandler = pubSubRecorder.handlers.get("activeViewChanged");
            activeHandler!({ document: doc });
            const track = tl.activeTrack();

            const closeHandler = pubSubRecorder.handlers.get("documentClosed");
            closeHandler!(makeDoc());

            expect(tl.activeTrack()).toBe(track);
        });
    });
});
