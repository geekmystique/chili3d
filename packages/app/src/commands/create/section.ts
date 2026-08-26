// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    type IStep,
    MultistepCommand,
    PubSub,
    SelectShapeStep,
    type ShapeNode,
    ShapeTypes,
    Transaction,
    VisualStates,
} from "@chili3d/core";
import { SectionNode, sweepRefFromPick } from "../../bodys";

@command({
    key: "create.section",
    icon: "icon-section",
})
export class Section extends MultistepCommand {
    protected override executeMainTask() {
        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            const shapePick = this.stepDatas[0].shapes[0];
            const pathPick = this.stepDatas[1].shapes[0];
            const shapeRef = sweepRefFromPick(shapePick.owner.node as ShapeNode, shapePick.shape);
            const pathRef = sweepRefFromPick(pathPick.owner.node as ShapeNode, pathPick.shape);

            const node = new SectionNode({
                document: this.document,
                shapeNodeId: shapeRef.nodeId,
                shapeShapeType: shapeRef.shapeType,
                shapeIndex: shapeRef.index,
                pathNodeId: pathRef.nodeId,
                pathShapeType: pathRef.shapeType,
                pathIndex: pathRef.index,
            });

            if (!node.shape.isOk) {
                PubSub.default.pub("showToast", "error.default:{0}", node.shape.error);
                node.dispose();
                return;
            }

            this.document.modelManager.rootNode.add(node);
            this.document.visual.update();
            PubSub.default.pub("showToast", "toast.success");
        });
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectShapeStep(ShapeTypes.shape, "prompt.select.shape", {
                selectedState: VisualStates.faceTransparent,
            }),
            new SelectShapeStep(ShapeTypes.shape, "prompt.select.shape", {
                beforeSelection: () => this.addFirstSelectedState(VisualStates.faceTransparent),
                afterSelection: () => this.removeFirstSelectedState(VisualStates.faceTransparent),
            }),
        ];
    }
}
