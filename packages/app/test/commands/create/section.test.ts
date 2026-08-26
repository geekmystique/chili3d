// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EditableShapeNode, type IDocument, type IShape, PubSub, Result, ShapeTypes } from "@chili3d/core";
import { afterAll, beforeAll, describe, expect, test } from "@rstest/core";
import { SectionNode } from "../../../src/bodys/section";
import { Section } from "../../../src/commands/create/section";
import {
    ensureGlobalStubApp,
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

/** A live source node whose shape implements section(), as SectionNode.generateShape() calls it directly. */
function liveFaceNode(doc: IDocument) {
    const shape = mockShape({ shapeType: ShapeTypes.face });
    (shape as unknown as { section: (o: IShape) => IShape }).section = () => mockShape();
    return new EditableShapeNode({
        document: doc,
        name: "face-source",
        shape: shape as unknown as IShape,
        materialId: "mat-1",
    });
}

describe("Section", () => {
    test("should have command metadata", () => {
        const data = (Section as any).prototype.data;
        expect(data).not.toBeNull();
        expect(data.key).toBe("create.section");
        expect(data.icon).toBe("icon-section");
    });

    test("getSteps should return two steps", () => {
        const cmd = new Section();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(2);
    });

    describe("executeMainTask", () => {
        test("should create one SectionNode referencing the picked shape and path nodes", () => {
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new Section();
                const { doc } = wireCommand(cmd);
                const parent = doc.modelManager.rootNode as unknown as TrackingParent;
                const shapeNode = liveFaceNode(doc);
                shapeNode.parent = parent;
                const pathNode = liveFaceNode(doc);
                pathNode.parent = parent;
                (doc.modelManager as any).findNode = (predicate: (n: unknown) => boolean) =>
                    [shapeNode, pathNode].find(predicate);

                seedStepDatas(cmd, [
                    shapeStepResult([{ shape: { shapeType: ShapeTypes.face }, node: shapeNode }]),
                    shapeStepResult([{ shape: { shapeType: ShapeTypes.face }, node: pathNode }]),
                ]);

                (cmd as any).executeMainTask();

                expect(parent.added).toHaveLength(1);
                const created = parent.added[0] as SectionNode;
                expect(created).toBeInstanceOf(SectionNode);
                expect(created.shapeNodeId).toBe(shapeNode.id);
                expect(created.pathNodeId).toBe(pathNode.id);
                expect((doc.visual.update as any).mock.calls.length).toBeGreaterThanOrEqual(1);
            } finally {
                restoreTx();
            }
        });

        test("should reference the sub-shape's type and index when a pick is one face of a multi-face pick", () => {
            const restoreTx = stubTransactionRun();
            try {
                const cmd = new Section();
                const { doc } = wireCommand(cmd);
                const parent = doc.modelManager.rootNode as unknown as TrackingParent;
                // shapeStepResult wraps the picked shape through mockShape(), which
                // copies the given properties onto a fresh object - so isEqual can't
                // rely on reference equality to the original candidate object here,
                // it has to compare a marker property that survives the copy.
                const targetFace: any = {
                    shapeType: ShapeTypes.face,
                    isEqual: (o: { marker?: string }) => o.marker === "picked",
                    section: () => mockShape(),
                };
                const solidShape = mockShape({ shapeType: ShapeTypes.solid });
                (solidShape as unknown as { findSubShapes: (type: number) => IShape[] }).findSubShapes = (
                    type: number,
                ) => (type === ShapeTypes.face ? [targetFace] : []);
                const solidNode = new EditableShapeNode({
                    document: doc,
                    name: "solid-source",
                    shape: solidShape as unknown as IShape,
                    materialId: "mat-1",
                });
                solidNode.parent = parent;
                const pathNode = liveFaceNode(doc);
                pathNode.parent = parent;
                (doc.modelManager as any).findNode = (predicate: (n: unknown) => boolean) =>
                    [solidNode, pathNode].find(predicate);

                seedStepDatas(cmd, [
                    shapeStepResult([
                        { shape: { shapeType: ShapeTypes.face, marker: "picked" } as any, node: solidNode },
                    ]),
                    shapeStepResult([{ shape: { shapeType: ShapeTypes.face }, node: pathNode }]),
                ]);

                (cmd as any).executeMainTask();

                const created = parent.added[0] as SectionNode;
                expect(created.shapeNodeId).toBe(solidNode.id);
                expect(created.shapeShapeType).toBe(ShapeTypes.face);
                expect(created.shapeIndex).toBe(0);
            } finally {
                restoreTx();
            }
        });

        test("should publish an error toast and add no node when the shape's base node cannot be resolved", () => {
            const restoreTx = stubTransactionRun();
            const published: unknown[][] = [];
            const origPub = PubSub.default.pub;
            PubSub.default.pub = (...args: unknown[]) => published.push(args);
            try {
                const cmd = new Section();
                const { doc } = wireCommand(cmd);
                const parent = doc.modelManager.rootNode as unknown as TrackingParent;
                // sweepRefFromPick reads owner.shape to decide whole-shape vs
                // sub-shape before the id is ever looked up, so it needs a shape
                // even though findNode below never resolves this id.
                const shapeOwner = {
                    id: "unregistered",
                    parent,
                    shape: Result.ok(mockShape({ shapeType: ShapeTypes.face })),
                } as any;
                const pathNode = liveFaceNode(doc);
                pathNode.parent = parent;
                (doc.modelManager as any).findNode = (predicate: (n: unknown) => boolean) =>
                    [pathNode].find(predicate);
                // findNode never resolves shapeOwner's id, so the reference never resolves.

                seedStepDatas(cmd, [
                    shapeStepResult([{ shape: { shapeType: ShapeTypes.face }, node: shapeOwner }]),
                    shapeStepResult([{ shape: { shapeType: ShapeTypes.face }, node: pathNode }]),
                ]);

                (cmd as any).executeMainTask();

                expect(parent.added).toHaveLength(0);
                const messages = published.filter((p) => p[0] === "showToast").map((p) => p[1]);
                expect(messages).toContain("error.default:{0}");
                expect(messages).not.toContain("toast.success");
            } finally {
                PubSub.default.pub = origPub;
                restoreTx();
            }
        });

        test("should publish the success toast on the happy path", () => {
            const restoreTx = stubTransactionRun();
            const published: unknown[][] = [];
            const origPub = PubSub.default.pub;
            PubSub.default.pub = (...args: unknown[]) => published.push(args);
            try {
                const cmd = new Section();
                const { doc } = wireCommand(cmd);
                const parent = doc.modelManager.rootNode as unknown as TrackingParent;
                const shapeNode = liveFaceNode(doc);
                shapeNode.parent = parent;
                const pathNode = liveFaceNode(doc);
                pathNode.parent = parent;
                (doc.modelManager as any).findNode = (predicate: (n: unknown) => boolean) =>
                    [shapeNode, pathNode].find(predicate);

                seedStepDatas(cmd, [
                    shapeStepResult([{ shape: { shapeType: ShapeTypes.face }, node: shapeNode }]),
                    shapeStepResult([{ shape: { shapeType: ShapeTypes.face }, node: pathNode }]),
                ]);

                (cmd as any).executeMainTask();

                const messages = published.filter((p) => p[0] === "showToast").map((p) => p[1]);
                expect(messages).toContain("toast.success");
            } finally {
                PubSub.default.pub = origPub;
                restoreTx();
            }
        });
    });

    describe("getSteps callbacks", () => {
        test("the second step should carry beforeSelection/afterSelection that update the first pick's highlight state", () => {
            const cmd = new Section();
            const { doc } = wireCommand(cmd);
            seedStepDatas(cmd, [shapeStepResult([{ shape: { shapeType: ShapeTypes.face } }])]);

            const steps = (cmd as any).getSteps();
            const opts = steps[1].options;
            expect(() => opts.beforeSelection()).not.toThrow();
            expect(() => opts.afterSelection()).not.toThrow();
            expect((doc.visual.highlighter.addState as any).mock.calls.length).toBeGreaterThanOrEqual(1);
            expect((doc.visual.highlighter.removeState as any).mock.calls.length).toBeGreaterThanOrEqual(1);
        });
    });
});
