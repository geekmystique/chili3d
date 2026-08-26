// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EditableShapeNode, type IShape, PubSub, Result, ShapeTypes } from "@chili3d/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, rs, test } from "@rstest/core";
import { CompoundNode } from "../../../src/bodys/compound";
import { FaceNode } from "../../../src/bodys/face";
import { ShellNode } from "../../../src/bodys/shell";
import { SolidNode } from "../../../src/bodys/solid";
import { WireNode } from "../../../src/bodys/wire";
import {
    CompoundEditCommand,
    FaceEditCommand,
    ShellEditCommand,
    SolidEditCommand,
    WireEditCommand,
} from "../../../src/commands/modify/convertEdit";
import {
    ensureGlobalStubApp,
    mockShape,
    seedStepDatas,
    stubTransactionRun,
    type TrackingParent,
    wireCommand,
} from "../commandTestUtils";

let restoreApp: () => void;
beforeAll(() => {
    restoreApp = ensureGlobalStubApp();
});
afterAll(() => restoreApp());

/** node-type SnapResult, matching what SelectNodeStep resolves to (see selectStep.ts). */
function nodeStepResult(nodes: unknown[]) {
    return { view: {} as any, type: "node" as const, shapes: [], nodes };
}

function buildEditCommand(
    CommandCtor: new () => any,
    NodeCtor: new (opts: { document: any; sourceNodeIds: string[] }) => any,
    makeSourceShape: () => IShape,
) {
    const cmd = new CommandCtor();
    const { doc } = wireCommand(cmd as any);
    const parent = doc.modelManager.rootNode as unknown as TrackingParent;

    const sourceNode = new EditableShapeNode({
        document: doc,
        name: "source",
        shape: makeSourceShape(),
    });
    sourceNode.parent = parent;

    const targetNode = new NodeCtor({ document: doc, sourceNodeIds: [sourceNode.id] });
    targetNode.parent = parent;

    const nodes: unknown[] = [sourceNode, targetNode];
    (doc.modelManager as any).findNode = (predicate: (n: unknown) => boolean) => nodes.find(predicate);
    (doc.selection as any).getSelectedNodes = () => [targetNode];

    return { cmd, doc, parent, sourceNode, targetNode, nodes };
}

const wireShape = () =>
    mockShape({ shapeType: ShapeTypes.wire, findSubShapes: () => [] }) as unknown as IShape;
const closedWireShape = () =>
    mockShape({
        shapeType: ShapeTypes.wire,
        isClosed: () => true,
        findSubShapes: () => [],
    }) as unknown as IShape;
const faceShape = () => mockShape({ shapeType: ShapeTypes.face }) as unknown as IShape;
const shellShape = () => mockShape({ shapeType: ShapeTypes.shell }) as unknown as IShape;
const anyShape = () => mockShape() as unknown as IShape;

describe.each([
    ["WireEditCommand", WireEditCommand, WireNode, "modify.wireEdit", "icon-toPoly", wireShape],
    ["FaceEditCommand", FaceEditCommand, FaceNode, "modify.faceEdit", "icon-toFace", closedWireShape],
    ["ShellEditCommand", ShellEditCommand, ShellNode, "modify.shellEdit", "icon-toShell", faceShape],
    ["SolidEditCommand", SolidEditCommand, SolidNode, "modify.solidEdit", "icon-toSolid", shellShape],
    [
        "CompoundEditCommand",
        CompoundEditCommand,
        CompoundNode,
        "modify.compoundEdit",
        "icon-compound",
        anyShape,
    ],
] as const)("%s", (_name, CommandCtor, NodeCtor, key, icon, makeSourceShape) => {
    let restoreTx: () => void;
    beforeEach(() => {
        restoreTx = stubTransactionRun();
    });
    afterEach(() => restoreTx());

    test("should have command metadata", () => {
        const data = (CommandCtor as any).prototype.data;
        expect(data.key).toBe(key);
        expect(data.icon).toBe(icon);
    });

    describe("canExcute", () => {
        test("should return false when nothing is selected", async () => {
            const { cmd, doc } = buildEditCommand(CommandCtor, NodeCtor, makeSourceShape);
            (doc.selection as any).getSelectedNodes = () => [];
            const pubSpy = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
            try {
                expect(await (cmd as any).canExcute()).toBe(false);
                expect(pubSpy).toHaveBeenCalledWith("showToast", "toast.select.noSelected");
            } finally {
                pubSpy.mockRestore();
            }
        });

        test("should find the target node", async () => {
            const { cmd, targetNode } = buildEditCommand(CommandCtor, NodeCtor, makeSourceShape);
            expect(await (cmd as any).canExcute()).toBe(true);
            expect((cmd as any).targetNode).toBe(targetNode);
        });
    });

    describe("executeMainTask", () => {
        test("should redirect to a new set of sources and recompute", () => {
            const { cmd, doc, targetNode, nodes } = buildEditCommand(CommandCtor, NodeCtor, makeSourceShape);
            (cmd as any).targetNode = targetNode;

            const newSourceNode = new EditableShapeNode({
                document: doc,
                name: "newSource",
                shape: makeSourceShape(),
            });
            nodes.push(newSourceNode);
            seedStepDatas(cmd as any, [nodeStepResult([newSourceNode]) as any]);

            (cmd as any).executeMainTask();

            expect(targetNode.sourceNodeIds).toEqual([newSourceNode.id]);
            expect(targetNode.shape.isOk).toBe(true);
        });

        test("should keep the existing sources when nothing was (re-)picked", () => {
            const { cmd, targetNode, sourceNode } = buildEditCommand(CommandCtor, NodeCtor, makeSourceShape);
            (cmd as any).targetNode = targetNode;
            seedStepDatas(cmd as any, [nodeStepResult([]) as any]);

            (cmd as any).executeMainTask();

            expect(targetNode.sourceNodeIds).toEqual([sourceNode.id]);
            expect(targetNode.shape.isOk).toBe(true);
        });

        test("should do nothing when there is no target node", () => {
            const { cmd, parent } = buildEditCommand(CommandCtor, NodeCtor, makeSourceShape);
            expect(() => (cmd as any).executeMainTask()).not.toThrow();
            expect(parent.added).toHaveLength(0);
        });

        test("should report a factory error via displayError", () => {
            const { cmd, targetNode } = buildEditCommand(CommandCtor, NodeCtor, makeSourceShape);
            (cmd as any).targetNode = targetNode;
            seedStepDatas(cmd as any, [nodeStepResult([]) as any]);
            (targetNode as any).generateShape = () => Result.err("boom");

            const pubSpy = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
            try {
                (cmd as any).executeMainTask();
                expect(pubSpy).toHaveBeenCalledWith("displayError", "boom");
            } finally {
                pubSpy.mockRestore();
            }
        });
    });
});
