// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    type GeometryNode,
    GeometryUtils,
    type IFace,
    type IShape,
    type IStep,
    type LengthAtAxisSnapData,
    LengthAtAxisStep,
    Precision,
    property,
    SelectShapeStep,
    type ShapeNode,
    type ShapeType,
    ShapeTypes,
    SnapEventHandler,
    spliceIntoReferenceChain,
} from "@chili3d/core";
import { closedProfileToFace, ExtrudeNode, sectionRefFromPick } from "../../bodys";
import { CreateFromSelectionCommand, selectedWholeShapeNodes } from "../createCommand";

@command({
    key: "create.extrude",
    icon: "icon-prism",
})
export class ExtrudeCommand extends CreateFromSelectionCommand {
    private createdNode?: ExtrudeNode;

    /**
     * Visible from the start of the command (like FilletCommand.radius),
     * defaulting to 10 - typing an exact value here applies it and finishes
     * the length step immediately (see the setter below), so the length can
     * be typed instead of dragged. While the length step is live-dragging,
     * getLengthStepData's preview callback keeps this in sync with the
     * pointer's current distance via setProperty directly (not through this
     * setter, which would otherwise re-finish the step on every mouse move).
     */
    @property("common.length")
    get length() {
        return this.getPrivateValue("length", 10);
    }
    set length(value: number) {
        const changed = this.setProperty("length", value);
        if (!changed) return;

        const view = this.document.application.activeView;
        const handler = this.document.visual.eventHandler;
        if (view && handler instanceof SnapEventHandler) {
            handler.applyTypedInput(view, String(value));
        }
    }

    protected override geometryNode(): GeometryNode {
        const pick = this.stepDatas[0].shapes[0];
        const shape = this.transformdFirstShape(this.stepDatas[0], false);
        const { point, normal } = this.getAxis(shape);
        const dist = this.stepDatas[1].point!.sub(point).dot(normal);

        const { shapeType, index } = sectionRefFromPick(pick.owner.node as ShapeNode, pick.shape);
        const node = new ExtrudeNode({
            document: this.document,
            sectionNodeId: (pick.owner.node as ShapeNode).id,
            sectionShapeType: shapeType,
            sectionIndex: index,
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
        this.repositionAfterSection();
    }

    /**
     * The new Extrude was appended to the tree by the shared CreateCommand
     * flow before afterNodeCreated ran. Move it to sit right after its
     * section node instead, so it lands at its logical spot in the
     * tree/timeline rather than always at the end.
     */
    private repositionAfterSection(): void {
        const createdNode = this.createdNode;
        if (!createdNode?.parent) return;
        const section = this.document.modelManager.findNode((n) => n.id === createdNode.sectionNodeId);
        if (!section?.parent) return;
        createdNode.parent.move(createdNode, section.parent, section);
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
                // Reflect the live drag distance in the properties panel - via
                // setProperty directly, not the length setter above, which
                // would otherwise re-finish the step on every mouse move.
                this.setProperty("length", dist);
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
            // Enter here (no click/drag, and never having focused the
            // properties-panel field either) would otherwise cancel the whole
            // command (SnapEventHandler's default) - accept the current
            // length instead, same as clicking to confirm a drag at it.
            acceptOnEnter: () => this.length,
        };
    };

    private getAxis(shape: IShape) {
        const point = this.stepDatas[0].shapes[0].point!;
        const normal = GeometryUtils.normal(shape as any);
        return { point, normal };
    }
}
