// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EditableShapeNode, type IDocument, type IShape, PubSub, Result, ShapeTypes } from "@chili3d/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, rs, test } from "@rstest/core";
import { EdgeCornerNode } from "../../../src/bodys/edgeCorner";
import { EdgeCornerEditCommand } from "../../../src/commands/modify/edgeCornerEdit";
import {
    ensureGlobalStubApp,
    type MockShape,
    mockShape,
    seedStepDatas,
    shapeStepResult,
    stubTransactionRun,
    type TrackingParent,
    wireCommand,
} from "../commandTestUtils";

let restoreApp: () => void;
beforeAll(() => {
    restoreApp = ensureGlobalStubApp();
});
afterAll(() => restoreApp());

/**
 * Build an edit command wired to a real base ShapeNode and a real EdgeCornerNode
 * referencing it - both EdgeCornerEditCommand and EdgeCornerNode resolve nodes
 * through `document.modelManager.findNode`, so plain object stubs won't do.
 */
function buildEditCommand(edgeIndexes: number[], opts: { value?: number } = {}) {
    const cmd = new EdgeCornerEditCommand();
    const { doc } = wireCommand(cmd);

    const parent = doc.modelManager.rootNode as unknown as TrackingParent;
    const baseShape = mockShape();
    const baseNode = new EditableShapeNode({
        document: doc,
        name: "solid0",
        shape: baseShape as unknown as IShape,
        materialId: "mat-1",
    });
    baseNode.parent = parent;

    const targetNode = new EdgeCornerNode({
        document: doc,
        operateType: "fillet",
        baseNodeId: baseNode.id,
        edgeIndexes: [1, 2],
        value: opts.value ?? 5,
    });
    targetNode.parent = parent;

    (doc.modelManager as any).findNode = (predicate: (n: unknown) => boolean) =>
        [baseNode, targetNode].find(predicate);
    (doc.selection as any).getSelectedNodes = () => [targetNode];
    (doc.selection as any).setSelectedNodes = rs.fn();

    const body = mockShape({ shapeType: ShapeTypes.solid });
    const step = shapeStepResult(
        edgeIndexes.map((index) => ({
            shape: { index, parent: body } as Partial<MockShape>,
            node: baseNode,
        })),
    );
    seedStepDatas(cmd, [step]);

    return { cmd, doc, parent, baseNode, targetNode, body };
}

/** Replace `PubSub.default.pub` with a recorder. */
function capturePubSub() {
    const original = PubSub.default.pub;
    const pubs: any[][] = [];
    PubSub.default.pub = ((...args: any[]) => {
        pubs.push(args);
    }) as any;
    return {
        pubs,
        restore: () => {
            PubSub.default.pub = original;
        },
    };
}

describe("EdgeCornerEditCommand", () => {
    let restoreTx: () => void;
    beforeEach(() => {
        restoreTx = stubTransactionRun();
    });
    afterEach(() => restoreTx());

    test("should have command metadata", () => {
        const data = (EdgeCornerEditCommand as any).prototype.data;
        expect(data.key).toBe("modify.edgeCornerEdit");
        expect(data.icon).toBe("icon-fillet");
    });

    describe("canExcute", () => {
        test("should report no selection and return false when nothing is selected", async () => {
            const { cmd, doc } = buildEditCommand([1, 2]);
            (doc.selection as any).getSelectedNodes = () => [];
            const pubsub = capturePubSub();

            try {
                const result = await (cmd as any).canExcute();
                expect(result).toBe(false);
                expect(pubsub.pubs).toContainEqual(["showToast", "toast.select.noSelected"]);
            } finally {
                pubsub.restore();
            }
        });

        test("should return false when the base node can no longer be resolved", async () => {
            const { cmd, doc } = buildEditCommand([1, 2]);
            (doc.modelManager as any).findNode = () => undefined;

            const result = await (cmd as any).canExcute();
            expect(result).toBe(false);
        });

        test("should pick up the target node's operateType and current value", async () => {
            const { cmd } = buildEditCommand([1, 2], { value: 8 });

            const result = await (cmd as any).canExcute();

            expect(result).toBe(true);
            expect(cmd.value).toBe(8);
            expect((cmd as any).operateType).toBe("fillet");
        });
    });

    describe("getSteps", () => {
        test("should only allow picking edges on the resolved base node", async () => {
            const { cmd, baseNode } = buildEditCommand([1, 2]);
            await (cmd as any).canExcute();

            const steps = (cmd as any).getSteps();
            const nodeFilter = steps[0].options.nodeFilter;

            expect(nodeFilter.allow(baseNode)).toBe(true);
            expect(nodeFilter.allow({})).toBe(false);
        });

        test("beforeSelection should show the base node and hide the feature; afterSelection restores both", async () => {
            const { cmd, baseNode, targetNode } = buildEditCommand([1, 2]);
            baseNode.visible = false;
            await (cmd as any).canExcute();

            const steps = (cmd as any).getSteps();
            steps[0].options.beforeSelection();
            expect(baseNode.visible).toBe(true);
            expect(targetNode.visible).toBe(false);

            steps[0].options.afterSelection();
            expect(baseNode.visible).toBe(false);
            expect(targetNode.visible).toBe(true);
        });
    });

    describe("executeMainTask", () => {
        test("should update the target node's edgeIndexes/value in place and recompute", () => {
            const { cmd, targetNode } = buildEditCommand([3, 7]);
            (cmd as any).targetNode = targetNode;
            (cmd as any).setPrivateValue("value", 9);

            (cmd as any).executeMainTask();

            expect(targetNode.edgeIndexes).toEqual([3, 7]);
            expect(targetNode.value).toBe(9);
            expect(targetNode.shape.isOk).toBe(true);
        });

        test("should not create a new node - the target keeps its identity", () => {
            const { cmd, targetNode, parent } = buildEditCommand([3, 7]);
            (cmd as any).targetNode = targetNode;

            (cmd as any).executeMainTask();

            expect(parent.added).toHaveLength(0);
        });

        test("should report a factory error via displayError", () => {
            const { cmd, targetNode } = buildEditCommand([3, 7]);
            (cmd as any).targetNode = targetNode;

            const original = (globalThis as any).app.shapeProvider.factory;
            Object.defineProperty((globalThis as any).app.shapeProvider, "factory", {
                configurable: true,
                value: { fillet: () => Result.err("boom") },
            });
            const pubsub = capturePubSub();
            try {
                (cmd as any).executeMainTask();
                expect(pubsub.pubs.some((args) => args[0] === "displayError" && args[1] === "boom")).toBe(
                    true,
                );
            } finally {
                pubsub.restore();
                Object.defineProperty((globalThis as any).app.shapeProvider, "factory", {
                    configurable: true,
                    value: original,
                });
            }
        });

        test("should do nothing when there is no target node", () => {
            const { cmd, parent } = buildEditCommand([3, 7]);

            expect(() => (cmd as any).executeMainTask()).not.toThrow();
            expect(parent.added).toHaveLength(0);
        });
    });

    describe("unsupported planar stubs", () => {
        test("applyToFace/applyToEdgePair should return an error", () => {
            const { cmd } = buildEditCommand([1]);
            expect((cmd as any).applyToFace().isOk).toBe(false);
            expect((cmd as any).applyToEdgePair().isOk).toBe(false);
        });
    });
});
