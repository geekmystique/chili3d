// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Registers the `@chili3d/core` mock for the timeline test: a GeometryNode marker
// class for instanceof checks, immediate Transaction, no-op Binding, and a
// PubSub recorder (see mockCorePubSub.ts - spreading the real PubSub through
// `...actual` here left the `PubSub` binding undefined at test-file scope).
// Import this module BEFORE the module under test (but AFTER the test-utils import) -
// see mockCoreTree.ts for why.

import { rs } from "@rstest/core";

const recorder = rs.hoisted(() => {
    const { createPubSubRecorder } = require("./coreMocks");
    return createPubSubRecorder();
});

/** Records topic/args passed to `PubSub.default.pub`. */
export const pubSubPubs = recorder.pubs;

/**
 * Invoke whatever handler is currently subscribed to `topic` - this recorder's
 * `pub` only logs calls (see pubSubPubs above), it doesn't invoke subscribers,
 * so tests exercising a `PubSub.default.sub(topic, ...)` callback drive it
 * through here instead of a real `pub()` call.
 */
export function firePubSub(topic: string, ...args: unknown[]) {
    recorder.handlers.get(topic)?.(...args);
}

/**
 * Spy standing in for the real removeFromReferenceChain - the timeline's
 * context-menu delete handler is tested for its own wiring (calls it inside
 * a Transaction with the right node, reacts to its return value) here; the
 * healing algorithm itself is covered against real ReferenceShapeNode
 * subclasses in core/test/shapeNode.test.ts.
 */
const removeChainRecorder = rs.hoisted(() => {
    const calls: unknown[][] = [];
    let result = true;
    return {
        calls,
        fn: (...args: unknown[]) => {
            calls.push(args);
            return result;
        },
        setResult: (r: boolean) => {
            result = r;
        },
    };
});

export const removeFromReferenceChainCalls = removeChainRecorder.calls;
export function setRemoveFromReferenceChainResult(result: boolean) {
    removeChainRecorder.setResult(result);
}

rs.mock("@chili3d/core", () => {
    const actual = rs.hoisted(() => require("@chili3d/core"));
    const { BindingMock, TransactionMock, LocalizeMock } = rs.hoisted(() => require("./coreMocks"));
    class VisualNode {}
    class GeometryNode extends VisualNode {}
    class ReferenceShapeNode extends GeometryNode {}
    return {
        ...actual,
        Binding: BindingMock,
        Localize: LocalizeMock,
        Transaction: TransactionMock,
        PubSub: recorder.stub,
        VisualNode,
        GeometryNode,
        ReferenceShapeNode,
        removeFromReferenceChain: removeChainRecorder.fn,
    };
});
