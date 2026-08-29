// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command, type IEdge, type IFace, type IShape, property, type Result } from "@chili3d/core";
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
     * exact value here applies it immediately if the radius-drag step (see
     * EdgeCornerCommand.getSteps) is already live, or queues it for the
     * instant that step starts otherwise, so typing while still picking
     * edges never requires touching the drag step at all.
     */
    set radius(value: number) {
        const changed = this.setProperty("radius", value);
        this.applyOrQueueTypedValue(value, changed);
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

    protected override applyToBody(shape: IShape, edgeIndexes: number[]): Result<IShape> {
        return shapeFactory.fillet(shape, edgeIndexes, this.radius);
    }

    protected override applyToFace(face: IFace, edge1: IEdge, edge2: IEdge): Result<IShape> {
        return shapeFactory.fillet2d(face, edge1, edge2, this.radius);
    }

    protected override applyToEdgePair(edge1: IEdge, edge2: IEdge): Result<IEdge[]> {
        return shapeFactory.filletEdge2d(edge1, edge2, this.radius);
    }
}
