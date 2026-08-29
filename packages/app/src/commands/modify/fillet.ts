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
    key: "modify.fillet",
    icon: "icon-fillet",
})
export class FilletCommand extends EdgeCornerCommand {
    @property("circle.radius")
    get radius() {
        return this.getPrivateValue("radius", 10);
    }

    /**
     * Visible from the start of the command, defaulting to 10 - typing an
     * exact value here applies it and finishes the radius-drag step
     * (EdgeCornerCommand.getSteps) immediately, the same pattern as
     * ExtrudeCommand.length. While the step is live-dragging,
     * EdgeCornerCommand's preview callback keeps this in sync with the
     * pointer via the cornerValue setter below, not this one, which would
     * otherwise re-finish the step every move.
     */
    set radius(value: number) {
        const changed = this.setProperty("radius", value);
        if (!changed) return;

        const view = this.document.application.activeView;
        const handler = this.document.visual.eventHandler;
        if (view && handler instanceof SnapEventHandler) {
            handler.applyTypedInput(view, String(value));
        }
    }

    protected override get operateType(): EdgeCornerOperateType {
        return "fillet";
    }

    protected override get cornerValue(): number {
        return this.radius;
    }
    protected override set cornerValue(value: number) {
        this.setProperty("radius", value);
    }

    protected override get cornerValuePromptKey() {
        return "prompt.pickRadius" as const;
    }

    protected override applyToFace(face: IFace, edge1: IEdge, edge2: IEdge): Result<IShape> {
        return shapeFactory.fillet2d(face, edge1, edge2, this.radius);
    }

    protected override applyToEdgePair(edge1: IEdge, edge2: IEdge): Result<IEdge[]> {
        return shapeFactory.filletEdge2d(edge1, edge2, this.radius);
    }
}
