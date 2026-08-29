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
    type ShapeType,
    ShapeTypes,
    SnapEventHandler,
} from "@chili3d/core";
import { closedProfileToFace, ExtrudeNode } from "../../bodys";
import { CreateFromSelectionCommand } from "../createCommand";

@command({
    key: "create.extrude",
    icon: "icon-prism",
})
export class ExtrudeCommand extends CreateFromSelectionCommand {
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
        const shape = this.transformdFirstShape(this.stepDatas[0], false);
        const { point, normal } = this.getAxis(shape);
        const dist = this.stepDatas[1].point!.sub(point).dot(normal);
        return new ExtrudeNode({ document: this.document, section: shape, length: dist });
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
            // Plain mouse movement over the 3D view (looking around, say)
            // must not silently change the length - only an explicit
            // Ctrl+move does.
            requireCtrlToDrag: true,
        };
    };

    private getAxis(shape: IShape) {
        const point = this.stepDatas[0].shapes[0].point!;
        const normal = GeometryUtils.normal(shape as any);
        return { point, normal };
    }
}
