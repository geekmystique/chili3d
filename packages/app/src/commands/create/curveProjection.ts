// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    type GeometryNode,
    I18n,
    type IStep,
    property,
    SelectShapeStep,
    type ShapeNode,
    type ShapeType,
    ShapeTypes,
    VisualStates,
} from "@chili3d/core";
import { CurveProjectionNode, sweepRefFromPick } from "../../bodys";
import { CreateCommand } from "../createCommand";

@command({
    key: "convert.curveProjection",
    icon: "icon-curveProject",
})
export class CurveProjectionCommand extends CreateCommand {
    private createdNode?: CurveProjectionNode;

    @property("common.dir")
    get dir() {
        return this.getPrivateValue("dir", "0,0,-1");
    }

    set dir(value: string) {
        const nums = value
            .split(",")
            .map(Number)
            .filter((n) => !isNaN(n));
        if (nums.length !== 3) {
            alert(I18n.translate("error.input.threeNumberCanBeInput"));

            return;
        }
        this.setProperty("dir", value);
    }

    protected override geometryNode(): GeometryNode {
        const shapePick = this.stepDatas[0].shapes[0];
        const facePick = this.stepDatas[1].shapes[0];
        const shapeRef = sweepRefFromPick(shapePick.owner.node as ShapeNode, shapePick.shape);
        const faceRef = sweepRefFromPick(facePick.owner.node as ShapeNode, facePick.shape);

        const node = new CurveProjectionNode({
            document: this.document,
            shapeNodeId: shapeRef.nodeId,
            shapeShapeType: shapeRef.shapeType,
            shapeIndex: shapeRef.index,
            faceNodeId: faceRef.nodeId,
            faceShapeType: faceRef.shapeType,
            faceIndex: faceRef.index,
            dir: this.dir,
        });
        this.createdNode = node;
        return node;
    }

    /**
     * The new CurveProjection was appended to the tree by the shared
     * CreateCommand flow before afterNodeCreated ran. Move it to sit right
     * after its shape node (CurveProjectionNode's primaryInputId) instead, so
     * it lands at its logical spot in the tree/timeline rather than always at
     * the end, matching Extrude/Revolve/Sweep.
     */
    protected override afterNodeCreated(): void {
        const createdNode = this.createdNode;
        if (!createdNode?.parent) return;
        const shape = this.document.modelManager.findNode((n) => n.id === createdNode.shapeNodeId);
        if (!shape?.parent) return;
        createdNode.parent.move(createdNode, shape.parent, shape);
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectShapeStep((ShapeTypes.edge | ShapeTypes.wire) as ShapeType, "prompt.select.shape"),
            new SelectShapeStep(ShapeTypes.face, "prompt.select.faces", {
                beforeSelection: () => this.addFirstSelectedState(VisualStates.edgeSelected),
                afterSelection: () => this.removeFirstSelectedState(VisualStates.edgeSelected),
            }),
        ];
    }
}
