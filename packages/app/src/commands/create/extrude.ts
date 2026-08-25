// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    type GeometryNode,
    GeometryUtils,
    type IFace,
    type IShape,
    type IStep,
    type ISubShape,
    type LengthAtAxisSnapData,
    LengthAtAxisStep,
    Precision,
    SelectShapeStep,
    type ShapeNode,
    type ShapeType,
    ShapeTypes,
    spliceIntoReferenceChain,
} from "@chili3d/core";
import { closedProfileToFace, ExtrudeNode } from "../../bodys";
import { CreateFromSelectionCommand, selectedWholeShapeNodes } from "../createCommand";

@command({
    key: "create.extrude",
    icon: "icon-prism",
})
export class ExtrudeCommand extends CreateFromSelectionCommand {
    private createdNode?: ExtrudeNode;

    protected override geometryNode(): GeometryNode {
        const pick = this.stepDatas[0].shapes[0];
        const shape = this.transformdFirstShape(this.stepDatas[0], false);
        const { point, normal } = this.getAxis(shape);
        const dist = this.stepDatas[1].point!.sub(point).dot(normal);

        const sub = pick.shape as Partial<ISubShape>;
        const node = new ExtrudeNode({
            document: this.document,
            sectionNodeId: (pick.owner.node as ShapeNode).id,
            sectionShapeType: sub.index !== undefined ? pick.shape.shapeType : undefined,
            sectionIndex: sub.index,
            length: dist,
        });
        this.createdNode = node;
        return node;
    }

    /**
     * Hide rather than delete the source node(s) - ExtrudeNode keeps a live
     * reference to whichever one it was picked from, so deleting it would
     * break that reference. Sub-shape picks (a face of an existing solid)
     * are excluded by selectedWholeShapeNodes, so that solid stays visible.
     * Any other feature that already referenced a hidden source (a boolean
     * built on the same sketch, say) gets pointed at the new Extrude instead.
     */
    protected override afterNodeCreated(): void {
        if (this.deleteObjects) {
            selectedWholeShapeNodes(this.stepDatas).forEach((node) => {
                node.visible = false;
                if (this.createdNode) spliceIntoReferenceChain(this.document, node, this.createdNode);
            });
        }
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectShapeStep(
                (ShapeTypes.face | ShapeTypes.edge | ShapeTypes.wire) as ShapeType,
                "prompt.select.shape",
            ),
            new LengthAtAxisStep("prompt.pickNextPoint", this.getLengthStepData, true),
        ];
    }

    private readonly getLengthStepData = (): LengthAtAxisSnapData => {
        const shape = this.transformdFirstShape(this.stepDatas[0]);
        const { point, normal } = this.getAxis(shape);
        return {
            point,
            direction: normal,
            preview: (p) => {
                if (!p) return [];
                const dist = p.sub(point).dot(normal);
                if (Math.abs(dist) < Precision.Float) return [];
                const vec = normal.multiply(dist);
                if (shape.shapeType === ShapeTypes.face) {
                    const sur = (shape as IFace).surface();
                    if (!sur.isPlanar()) {
                        return [this.meshCreatedShape("makeThickSolidBySimple", shape, dist)];
                    }
                } else if (
                    (shape.shapeType === ShapeTypes.wire || shape.shapeType === ShapeTypes.edge) &&
                    shape.isClosed()
                ) {
                    const face = closedProfileToFace(shape);
                    if (face.isOk) {
                        return [this.meshCreatedShape("prism", face.value, vec)];
                    }
                }
                return [this.meshCreatedShape("prism", shape, vec)];
            },
        };
    };

    private getAxis(shape: IShape) {
        const point = this.stepDatas[0].shapes[0].point!;
        const normal = GeometryUtils.normal(shape as any);
        return { point, normal };
    }
}
