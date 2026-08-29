// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    type IEdge,
    type IFace,
    type IShape,
    property,
    type Result,
    SnapEventHandler,
} from "@chili3d/core";
import type { EdgeCornerOperateType } from "../../bodys/edgeCorner";
import { EdgeCornerCommand } from "./edgeCornerCommand";

@command({
    key: "modify.chamfer",
    icon: "icon-chamfer",
})
export class ChamferCommand extends EdgeCornerCommand {
    @property("common.length")
    get length() {
        return this.getPrivateValue("length", 10);
    }

    /**
     * Visible from the start of the command, defaulting to 10 - typing an
     * exact value here applies it and finishes the distance-drag step
     * (EdgeCornerCommand.getSteps) immediately, the same pattern as
     * ExtrudeCommand.length/FilletCommand.radius. While the step is
     * live-dragging, EdgeCornerCommand's preview callback keeps this in sync
     * with the pointer via the cornerValue setter below, not this one, which
     * would otherwise re-finish the step every move.
     */
    set length(value: number) {
        const changed = this.setProperty("length", value);
        if (!changed) return;

        const view = this.document.application.activeView;
        const handler = this.document.visual.eventHandler;
        if (view && handler instanceof SnapEventHandler) {
            handler.applyTypedInput(view, String(value));
        }
    }

    protected override get operateType(): EdgeCornerOperateType {
        return "chamfer";
    }

    protected override get cornerValue(): number {
        return this.length;
    }
    protected override set cornerValue(value: number) {
        this.setProperty("length", value);
    }

    protected override applyToFace(face: IFace, edge1: IEdge, edge2: IEdge): Result<IShape> {
        return shapeFactory.chamfer2d(face, edge1, edge2, this.length);
    }

    protected override applyToEdgePair(edge1: IEdge, edge2: IEdge): Result<IEdge[]> {
        return shapeFactory.chamferEdge2d(edge1, edge2, this.length);
    }
}
