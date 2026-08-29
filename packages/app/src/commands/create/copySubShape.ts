// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    MultistepCommand,
    PubSub,
    SelectShapeStep,
    type ShapeNode,
    type ShapeType,
    ShapeTypes,
    ShapeTypeUtils,
    Transaction,
} from "@chili3d/core";
import { CopySubShapeNode, sweepRefFromPick } from "../../bodys";

@command({
    key: "create.copyShape",
    icon: "icon-subShape",
})
export class CopySubShapeCommand extends MultistepCommand {
    protected override executeMainTask() {
        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            this.stepDatas[0].shapes.forEach((x) => {
                const ref = sweepRefFromPick(x.owner.node as ShapeNode, x.shape);
                const model = new CopySubShapeNode({
                    document: this.document,
                    sourceNodeId: ref.nodeId,
                    subShapeType: ref.shapeType,
                    index: ref.index,
                });
                model.name = ShapeTypeUtils.stringValue(x.shape.shapeType);

                const node = x.owner.node;
                node.parent?.insertAfter(node, model);
            });
            this.document.visual.update();
            PubSub.default.pub("showToast", "toast.success");
        });
    }

    protected override getSteps() {
        return [
            new SelectShapeStep((ShapeTypes.edge | ShapeTypes.face) as ShapeType, "prompt.select.shape", {
                multiple: true,
            }),
        ];
    }
}
