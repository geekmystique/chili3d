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

        return new CurveProjectionNode({
            document: this.document,
            shapeNodeId: shapeRef.nodeId,
            shapeShapeType: shapeRef.shapeType,
            shapeIndex: shapeRef.index,
            faceNodeId: faceRef.nodeId,
            faceShapeType: faceRef.shapeType,
            faceIndex: faceRef.index,
            dir: this.dir,
        });
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
