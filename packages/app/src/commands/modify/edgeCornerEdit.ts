// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    type IEdge,
    type IShape,
    type ISubEdgeShape,
    PubSub,
    property,
    Result,
    ShapeNode,
    ShapeTypes,
    Transaction,
} from "@chili3d/core";
import { EdgeCornerNode, type EdgeCornerOperateType } from "../../bodys/edgeCorner";
import { EdgeCornerCommand } from "./edgeCornerCommand";
import { KeepExistingSelectionStep } from "./keepExistingSelectionStep";

/**
 * Re-picks the edges (and/or value) of an existing EdgeCornerNode, updating
 * it in place instead of creating a new feature - so anything downstream
 * that references it keeps working. Operates on the node currently selected
 * in the tree/timeline; invoked by double-clicking that entry.
 *
 * Only the base body already referenced by the feature can be re-picked from
 * - the nodeFilter below keeps that body the only pickable one - swapping to
 * a different base node entirely is a bigger change left for later.
 */
@command({
    key: "modify.edgeCornerEdit",
    icon: "icon-fillet",
})
export class EdgeCornerEditCommand extends EdgeCornerCommand {
    private targetNode?: EdgeCornerNode;
    private baseNode?: ShapeNode;
    private baseWasVisible = false;
    private targetWasVisible = false;

    @property("common.length")
    get value() {
        return this.getPrivateValue("value", this.targetNode?.value ?? 0);
    }
    set value(v: number) {
        this.setProperty("value", v);
    }

    protected override get operateType(): EdgeCornerOperateType {
        return this.targetNode?.operateType ?? "fillet";
    }

    protected override get cornerValue(): number {
        return this.value;
    }

    protected override applyToFace(): Result<IShape> {
        return Result.err("EdgeCornerEditCommand only supports body features.");
    }

    protected override applyToEdgePair(): Result<IEdge[]> {
        return Result.err("EdgeCornerEditCommand only supports body features.");
    }

    protected override async canExcute(): Promise<boolean> {
        const node = this.document.selection
            .getSelectedNodes()
            .find((n): n is EdgeCornerNode => n instanceof EdgeCornerNode);
        if (!node) {
            PubSub.default.pub("showToast", "toast.select.noSelected");
            return false;
        }
        const base = this.document.modelManager.findNode((n) => n.id === node.baseNodeId);
        if (!(base instanceof ShapeNode)) {
            PubSub.default.pub("showToast", "toast.select.noSelected");
            return false;
        }

        this.targetNode = node;
        this.baseNode = base;
        // Through the property setter (not setPrivateValue) so the already-open
        // command context panel's binding picks up the corrected value - it
        // rendered with the pre-canExcute default before this ran.
        this.value = node.value;
        return true;
    }

    protected override getSteps() {
        return [
            new KeepExistingSelectionStep(ShapeTypes.edge, "prompt.select.edges", {
                multiple: true,
                shapeFilter: this._edgeFilter,
                nodeFilter: { allow: (node) => node === this.baseNode },
                canFinish: this._canFinish,
                beforeSelection: this.showBaseForPicking,
                afterSelection: this.restoreVisibility,
            }),
        ];
    }

    private readonly showBaseForPicking = () => {
        if (!this.baseNode || !this.targetNode) return;
        this.baseWasVisible = this.baseNode.visible;
        this.targetWasVisible = this.targetNode.visible;
        this.baseNode.visible = true;
        this.targetNode.visible = false;
        this.document.visual.update();
    };

    private readonly restoreVisibility = () => {
        if (this.baseNode) this.baseNode.visible = this.baseWasVisible;
        if (this.targetNode) this.targetNode.visible = this.targetWasVisible;
        this.document.visual.update();
    };

    protected override executeMainTask() {
        if (!this.targetNode) return;

        const shapes = this.stepDatas[0].shapes;
        const node = this.targetNode;
        const edgeIndexes =
            shapes.length > 0 ? shapes.map((x) => (x.shape as ISubEdgeShape).index) : node.edgeIndexes;
        const value = this.value;

        Transaction.execute(this.document, `edit ${node.name}`, () => {
            node.updateSelection(edgeIndexes, value);
        });

        this.document.visual.update();
    }
}
