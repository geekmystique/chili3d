// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    type IStep,
    type ISubShape,
    MultistepCommand,
    PubSub,
    property,
    SelectShapeStep,
    type ShapeNode,
    ShapeTypes,
    Transaction,
} from "@chili3d/core";
import { ThickSolidNode } from "../../bodys/thickSolid";

@command({
    key: "create.thickSolid",
    icon: "icon-thickSolid",
})
export class ThickSolidCommand extends MultistepCommand {
    @property("option.command.thickness")
    get thickness() {
        return this.getPrivateValue("thickness", 10);
    }
    set thickness(value: number) {
        this.setProperty("thickness", value);
    }

    protected override executeMainTask(): void {
        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            this.stepDatas[0].shapes.forEach((x) => {
                const sub = x.shape as Partial<ISubShape>;
                const node = new ThickSolidNode({
                    document: this.document,
                    sectionNodeId: (x.owner.node as ShapeNode).id,
                    sectionShapeType: sub.index !== undefined ? x.shape.shapeType : undefined,
                    sectionIndex: sub.index,
                    thickness: this.thickness,
                });

                if (!node.shape.isOk) {
                    PubSub.default.pub("showToast", "toast.converter.error");
                    node.dispose();
                    return;
                }

                const sourceNode = x.owner.node;
                sourceNode.parent!.insertAfter(sourceNode, node);
            });
            this.document.visual.update();
            PubSub.default.pub("showToast", "toast.success");
        });
    }

    protected override getSteps(): IStep[] {
        return [new SelectShapeStep(ShapeTypes.face, "prompt.select.faces", { multiple: true })];
    }
}
