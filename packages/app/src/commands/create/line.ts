// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    Dimensions,
    type GeometryNode,
    type IStep,
    type PointSnapData,
    PointStep,
    Precision,
    property,
    type SnapResult,
    type XYZ,
} from "@chili3d/core";
import { LineNode } from "../../bodys";
import { CreateCommand } from "../createCommand";

@command({
    key: "create.line",
    icon: "icon-line",
})
export class Line extends CreateCommand {
    @property("option.command.isConnected")
    get isContinue() {
        return this.getPrivateValue("isContinue", true);
    }
    set isContinue(value: boolean) {
        this.setProperty("isContinue", value);
    }

    protected override geometryNode(): GeometryNode {
        return new LineNode({
            document: this.document,
            start: this.stepDatas[0].point!,
            end: this.stepDatas[1].point!,
        });
    }

    protected override executeMainTask(): void {
        super.executeMainTask();
        this.repeatOperation = true;
    }

    getSteps(): IStep[] {
        const firstStep = new PointStep("prompt.pickFistPoint");
        const secondStep = new PointStep("prompt.pickNextPoint", this.getSecondPointData);
        return [firstStep, secondStep];
    }

    protected override resetStepDatas() {
        if (this.isContinue) {
            this.stepDatas[0] = this.stepDatas[1];
            this.stepDatas.length = 1;
        } else {
            this.stepDatas.length = 0;
        }
    }

    private readonly getSecondPointData = (): PointSnapData => {
        return {
            refPoint: () => this.stepDatas[0].point!,
            dimension: Dimensions.D1D2D3,
            validator: (point: XYZ) => {
                return this.stepDatas[0].point!.distanceTo(point) > Precision.Distance;
            },
            preview: this.linePreview,
            // TEMP DIAGNOSTIC: also show the x/y offset from the start point
            // (not just the straight-line distance) so grid snapping - which
            // rounds x/y independently - can be visually confirmed even when
            // dragging off-axis, where the diagonal distance itself is never
            // a round number regardless of whether the point is grid-snapped.
            prompt: (snaped: SnapResult) => {
                const start = this.stepDatas[0].point!;
                const plane = snaped.plane ?? snaped.view.workplane;
                const vector = snaped.point!.sub(start);
                const dx = vector.dot(plane.xvec);
                const dy = vector.dot(plane.yvec);
                return `dx ${dx.toFixed(2)}, dy ${dy.toFixed(2)}`;
            },
        };
    };

    private readonly linePreview = (point: XYZ | undefined) => {
        if (!point) {
            return [this.meshPoint(this.stepDatas[0].point!)];
        }
        return [this.meshPoint(this.stepDatas[0].point!), this.meshLine(this.stepDatas[0].point!, point)];
    };
}
