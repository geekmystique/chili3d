// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    Combobox,
    Continuities,
    type Continuity,
    command,
    MultistepCommand,
    PubSub,
    property,
    type ShapeNode,
    type ShapeType,
    ShapeTypes,
    Transaction,
} from "@chili3d/core";
import { LoftNode, sweepRefFromPick } from "../../bodys";
import { KeepExistingSelectionStep } from "./keepExistingSelectionStep";

/**
 * Re-picks the section selection of an existing LoftNode, updating it in
 * place instead of creating a new feature - so anything downstream that
 * references it keeps working. Operates on the node currently selected in
 * the tree/timeline; invoked by double-clicking that entry.
 *
 * Unlike LoftCommand's open-ended "keep picking until you confirm" flow, this
 * uses one multiple-selection step: pick as many sections as you want and
 * confirm, replacing the whole list, or confirm without picking anything to
 * leave the current sections untouched. isSolid/isRuled/continuity have no
 * independent editing route on the node itself (like LoftCommand's own
 * properties at creation time), so they're exposed here instead, defaulting
 * to the target's current values.
 */
@command({
    key: "modify.loftEdit",
    icon: "icon-loft",
})
export class LoftEditCommand extends MultistepCommand {
    private targetNode?: LoftNode;

    @property("option.command.isSolid")
    get isSolid() {
        return this.getPrivateValue("isSolid", this.targetNode?.isSolid ?? false);
    }
    set isSolid(value: boolean) {
        this.setProperty("isSolid", value);
    }

    @property("option.command.isRuled")
    get isRuled() {
        return this.getPrivateValue("isRuled", this.targetNode?.isRuled ?? false);
    }
    set isRuled(value: boolean) {
        this.setProperty("isRuled", value);
    }

    @property("option.command.continuity", {
        dependencies: [{ property: "isRuled", value: false }],
        combobox: Combobox.from([...Continuities]),
    })
    get continuity(): Continuity {
        return this.getPrivateValue("continuity", this.targetNode?.continuity ?? Continuities[0]);
    }
    set continuity(value: Continuity) {
        this.setProperty("continuity", value);
    }

    protected override async canExcute(): Promise<boolean> {
        const node = this.document.selection
            .getSelectedNodes()
            .find((n): n is LoftNode => n instanceof LoftNode);
        if (!node) {
            PubSub.default.pub("showToast", "toast.select.noSelected");
            return false;
        }
        this.targetNode = node;
        // Through the property setters (not setPrivateValue) so the already-open
        // command context panel's binding picks up the corrected values.
        this.isSolid = node.isSolid;
        this.isRuled = node.isRuled;
        this.continuity = node.continuity;
        return true;
    }

    protected override getSteps() {
        return [
            new KeepExistingSelectionStep(
                (ShapeTypes.vertex | ShapeTypes.wire | ShapeTypes.edge) as ShapeType,
                "prompt.select.section",
                { multiple: true },
            ),
        ];
    }

    protected override executeMainTask() {
        const node = this.targetNode;
        if (!node) return;

        const picks = this.stepDatas[0].shapes;

        Transaction.execute(this.document, `edit ${node.name}`, () => {
            if (picks.length > 0) {
                const refs = picks.map((p) => sweepRefFromPick(p.owner.node as ShapeNode, p.shape));
                node.updateSections(
                    refs.map((r) => r.nodeId),
                    refs.map((r) => r.shapeType),
                    refs.map((r) => r.index),
                    this.isSolid,
                    this.isRuled,
                    this.continuity,
                );
            } else {
                node.updateSections(
                    node.sectionNodeIds,
                    node.sectionShapeTypes,
                    node.sectionIndexes,
                    this.isSolid,
                    this.isRuled,
                    this.continuity,
                );
            }
        });

        if (!node.shape.isOk) {
            PubSub.default.pub("displayError", node.shape.error);
        }
        this.document.visual.update();
    }
}
