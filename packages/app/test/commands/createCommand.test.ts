// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    EditableShapeNode,
    type GeometryNode,
    type IDocument,
    type IStep,
    Result,
    type ShapeType,
    ShapeTypes,
    XYZ,
} from "@chili3d/core";
import { afterAll, beforeAll, describe, expect, test } from "@rstest/core";
import { Sweep } from "../../src/commands/create/sweep";
import { CreateFromSelectionCommand, selectedWholeShapeNodes } from "../../src/commands/createCommand";
import {
    ensureGlobalStubApp,
    makeParent,
    mockShape,
    seedStepDatas,
    shapeStepResult,
    wireCommand,
} from "./commandTestUtils";

let restoreApp: () => void;
beforeAll(() => {
    restoreApp = ensureGlobalStubApp();
});
afterAll(() => restoreApp());

function shapeNode(document: IDocument, shapeType: ShapeType) {
    return new EditableShapeNode({
        document,
        name: "node",
        shape: Result.ok(mockShape({ shapeType })),
    });
}

/**
 * A bare CreateFromSelectionCommand with no afterNodeCreated override, for
 * exercising the base class's own default behavior in isolation - a real
 * command (Sweep, Extrude, Revolve, ...) may override afterNodeCreated to
 * hide-and-splice into a reference chain instead, so coupling this test to
 * one of those would break the moment that command grows its own override.
 */
class TestCreateFromSelectionCommand extends CreateFromSelectionCommand {
    protected override geometryNode(): GeometryNode {
        throw new Error("not used in these tests");
    }
    protected override getSteps(): IStep[] {
        return [];
    }
}

describe("selectedWholeShapeNodes", () => {
    test("should return the node when the selected shape type matches the node shape type", () => {
        const cmd = new Sweep();
        const { doc } = wireCommand(cmd);
        const node = shapeNode(doc, ShapeTypes.edge);
        const datas = [shapeStepResult([{ shape: { shapeType: ShapeTypes.edge }, node, point: XYZ.zero }])];

        expect(selectedWholeShapeNodes(datas)).toEqual([node]);
    });

    test("should exclude the node when a sub-shape type was selected", () => {
        const cmd = new Sweep();
        const { doc } = wireCommand(cmd);
        const node = shapeNode(doc, ShapeTypes.solid);
        const datas = [shapeStepResult([{ shape: { shapeType: ShapeTypes.face }, node, point: XYZ.zero }])];

        expect(selectedWholeShapeNodes(datas)).toEqual([]);
    });

    test("should exclude owners that are not shape nodes", () => {
        const datas = [shapeStepResult([{ shape: { shapeType: ShapeTypes.edge }, point: XYZ.zero }])];

        expect(selectedWholeShapeNodes(datas)).toEqual([]);
    });

    test("should deduplicate nodes selected in multiple steps", () => {
        const cmd = new Sweep();
        const { doc } = wireCommand(cmd);
        const node = shapeNode(doc, ShapeTypes.wire);
        const datas = [
            shapeStepResult([{ shape: { shapeType: ShapeTypes.wire }, node, point: XYZ.zero }]),
            shapeStepResult([{ shape: { shapeType: ShapeTypes.wire }, node, point: XYZ.zero }]),
        ];

        expect(selectedWholeShapeNodes(datas)).toEqual([node]);
    });
});

describe("CreateFromSelectionCommand", () => {
    test("deleteObjects should default to true", () => {
        const cmd = new TestCreateFromSelectionCommand();
        expect(cmd.deleteObjects).toBe(true);
    });

    test("afterNodeCreated should remove matched nodes from their parents", () => {
        const cmd = new TestCreateFromSelectionCommand();
        const { doc } = wireCommand(cmd);
        const matched = shapeNode(doc, ShapeTypes.edge);
        const matchedParent = makeParent();
        (matched as any).parent = matchedParent;
        const subShapeOwner = shapeNode(doc, ShapeTypes.solid);
        const subShapeParent = makeParent();
        (subShapeOwner as any).parent = subShapeParent;
        seedStepDatas(cmd, [
            shapeStepResult([
                { shape: { shapeType: ShapeTypes.edge }, node: matched, point: XYZ.zero },
                { shape: { shapeType: ShapeTypes.face }, node: subShapeOwner, point: XYZ.zero },
            ]),
        ]);

        (cmd as any).afterNodeCreated();

        expect(matchedParent.removed).toEqual([matched]);
        expect(subShapeParent.removed).toEqual([]);
    });

    test("afterNodeCreated should keep all nodes when deleteObjects is false", () => {
        const cmd = new TestCreateFromSelectionCommand();
        const { doc } = wireCommand(cmd);
        cmd.deleteObjects = false;
        const node = shapeNode(doc, ShapeTypes.edge);
        const parent = makeParent();
        (node as any).parent = parent;
        seedStepDatas(cmd, [
            shapeStepResult([{ shape: { shapeType: ShapeTypes.edge }, node, point: XYZ.zero }]),
        ]);

        (cmd as any).afterNodeCreated();

        expect(parent.removed).toEqual([]);
    });
});
